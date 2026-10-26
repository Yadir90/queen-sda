/* Tipos del núcleo WebAuthn del navegador (webauthnClientCore.mjs). */

export interface WebAuthnCredentialDescriptorJson {
  id: string
  type: string
  transports?: string[]
}

export interface RegistrationOptionsJson {
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: string; alg: number }>
  timeout?: number
  attestation?: string
  excludeCredentials?: WebAuthnCredentialDescriptorJson[]
  authenticatorSelection?: Record<string, unknown>
  [key: string]: unknown
}

export interface AuthenticationOptionsJson {
  challenge: string
  rpId: string
  timeout?: number
  userVerification?: string
  allowCredentials?: WebAuthnCredentialDescriptorJson[]
  [key: string]: unknown
}

export interface SerializedRegistrationCredential {
  id: string
  rawId: string
  type: string
  authenticatorAttachment: string | null
  clientExtensionResults: Record<string, unknown>
  transports: string[]
  response: { clientDataJSON: string; attestationObject: string }
}

export interface SerializedAuthenticationCredential {
  id: string
  rawId: string
  type: string
  authenticatorAttachment: string | null
  clientExtensionResults: Record<string, unknown>
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle: string | null
  }
}

export function b64urlEncode(buffer: ArrayBuffer | ArrayBufferView): string
export function b64urlToBuffer(text: string): ArrayBuffer
export function decodeCreationOptions(json: RegistrationOptionsJson): PublicKeyCredentialCreationOptions
export function decodeRequestOptions(json: AuthenticationOptionsJson): PublicKeyCredentialRequestOptions
export function serializeRegistrationCredential(credential: PublicKeyCredential): SerializedRegistrationCredential
export function serializeAuthenticationCredential(credential: PublicKeyCredential): SerializedAuthenticationCredential
