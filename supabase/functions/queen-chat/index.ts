// Queen SDA — Edge Function «queen-chat»: la CAPA DE LENGUAJE de Queen.
//
// Despliegue (puerta final, lo hace el dueño con guía):
//   supabase functions deploy queen-chat
//   supabase secrets set GEMINI_API_KEY=<clave gratuita de AI Studio del dueño>
//   Respaldo opcional (Cloudflare Workers AI gratis):
//   supabase secrets set CF_ACCOUNT_ID=<id> CF_API_TOKEN=<token>
//
// Contrato y límites (solución de IA aprobada el 2026-10-25):
// - El cerebro de Queen es DETERMINISTA (queenCore en la app): calcula
//   las cifras. Esta función SOLO redacta: recibe la pregunta y las
//   cifras ya verificadas de la respuesta determinista (`figures`),
//   nunca la base entera, y tiene prohibido inventar cifras nuevas.
// - Exige sesión válida de Supabase Auth y un rol asignado
//   (user_roles): sin sesión o sin rol, no responde.
// - La clave de Gemini vive SOLO como secreto de esta función; jamás
//   en la app ni en su bundle.
// - Si Gemini no está configurado o agota su cuota, se intenta el
//   respaldo de Cloudflare Workers AI. Si ninguno está disponible,
//   responde { ok:false, configured:false } con el motivo: la app lo
//   declara y Queen sigue en determinista. Nunca finge una respuesta.
// - Privacidad: al proveedor solo viaja la pregunta y las cifras de
//   esa respuesta concreta (en el nivel gratuito de Gemini el texto
//   puede usarse para entrenar: por eso no sale nada más).

// @ts-nocheck — Deno (Supabase Edge Functions); no forma parte del build de la app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function systemPrompt(question: string, figures: Array<{ label: string; value: unknown }>): string {
  const facts = figures.map((f) => `- ${f.label}: ${f.value}`).join('\n')
  return [
    'Eres Queen, la asistente del restaurante-bar La Reina (sistema Queen SDA).',
    'Redacta en español natural y directo, como una colega, sin relleno ni fórmulas.',
    'REGLA ABSOLUTA: solo puedes usar las cifras verificadas que vienen abajo.',
    'No inventes ninguna cifra, fecha ni nombre que no esté en esa lista.',
    'Si la pregunta pide algo que no está en las cifras, dilo con honestidad.',
    '',
    `Pregunta del dueño: ${question}`,
    '',
    'Cifras verificadas (calculadas por el código determinista del sistema):',
    facts || '(sin cifras para esta respuesta)',
  ].join('\n')
}

async function callGemini(key: string, prompt: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  })
  if (res.status === 429) throw new Error('quota')
  if (!res.ok) throw new Error(`gemini-${res.status}`)
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('').trim()
  if (!text) throw new Error('gemini-empty')
  return text
}

async function callCloudflare(accountId: string, token: string, prompt: string): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  })
  if (res.status === 429) throw new Error('quota')
  if (!res.ok) throw new Error(`cloudflare-${res.status}`)
  const data = await res.json()
  const text = String(data?.result?.response ?? '').trim()
  if (!text) throw new Error('cloudflare-empty')
  return text
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, reason: 'Método no permitido.' }), { status: 405, headers: JSON_HEADERS })
  }

  // 1) Sesión válida y rol asignado (la función no es pública).
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ ok: false, reason: 'Sesión no válida: la capa de lenguaje solo responde a usuarios del sistema.' }), { status: 401, headers: JSON_HEADERS })
  }
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', userData.user.id)
  if (!roles || roles.length === 0) {
    return new Response(JSON.stringify({ ok: false, reason: 'El usuario no tiene rol asignado en el sistema.' }), { status: 403, headers: JSON_HEADERS })
  }

  // 2) Entrada acotada: pregunta + cifras verificadas, nada más.
  let body: { question?: unknown; figures?: unknown }
  try { body = await req.json() } catch { body = {} }
  const question = typeof body.question === 'string' ? body.question.slice(0, 500) : ''
  const figures = Array.isArray(body.figures)
    ? body.figures.slice(0, 12).map((f: { label?: unknown; value?: unknown }) => ({ label: String(f?.label ?? '').slice(0, 80), value: f?.value ?? '' }))
    : []
  if (!question) {
    return new Response(JSON.stringify({ ok: false, reason: 'Falta la pregunta.' }), { status: 400, headers: JSON_HEADERS })
  }
  const prompt = systemPrompt(question, figures)

  // 3) Gemini primero; Cloudflare Workers AI como respaldo automático.
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  const cfAccount = Deno.env.get('CF_ACCOUNT_ID') ?? ''
  const cfToken = Deno.env.get('CF_API_TOKEN') ?? ''
  const failures: string[] = []

  if (geminiKey) {
    try {
      const text = await callGemini(geminiKey, prompt)
      return new Response(JSON.stringify({ ok: true, provider: 'gemini', text }), { headers: JSON_HEADERS })
    } catch (e) {
      failures.push(`Gemini: ${e instanceof Error ? e.message : 'error'}`)
    }
  }
  if (cfAccount && cfToken) {
    try {
      const text = await callCloudflare(cfAccount, cfToken, prompt)
      return new Response(JSON.stringify({ ok: true, provider: 'cloudflare', text }), { headers: JSON_HEADERS })
    } catch (e) {
      failures.push(`Cloudflare: ${e instanceof Error ? e.message : 'error'}`)
    }
  }

  // 4) Sin capa disponible: aviso honesto, nunca error opaco ni texto fingido.
  const configured = Boolean(geminiKey || (cfAccount && cfToken))
  return new Response(JSON.stringify({
    ok: false,
    configured,
    reason: configured
      ? `La capa de lenguaje no respondió ahora (${failures.join(' · ')}). Puede ser la cuota gratuita del día: Queen sigue en determinista y la conversación libre vuelve cuando el proveedor responda.`
      : 'La capa de lenguaje aún no está configurada: falta el secreto GEMINI_API_KEY de la función (la clave gratuita la crea el dueño en AI Studio). Queen sigue respondiendo en determinista.',
  }), { headers: JSON_HEADERS })
})
