import { Component, type ReactNode } from 'react'

/* Límite de error de la ficha (ronda 26-oct, defecto 7): si un
   bloque de la ficha falla al pintar con los datos reales del
   servidor, el fallo se ve AQUÍ, en español y en su sitio, con
   reintento — en vez de desmontar la ficha entera en silencio y
   dejar al administrador sin formularios ni explicación. El
   resto de bloques de la ficha sigue vivo. */
export class FichaBoundary extends Component<
  { children: ReactNode; bloque: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Visible también en consola para diagnóstico; la interfaz
    // ya muestra el aviso (nada de fallos silenciosos).
    console.error(`Ficha RH · bloque «${this.props.bloque}»:`, error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-box" role="alert" style={{ margin: '12px 0' }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>El bloque «{this.props.bloque}» de esta ficha no se pudo mostrar.</strong>{' '}
            Tus datos no se tocaron. Suele ser un dato de esta persona con una forma que la ficha no esperaba;
            el resto de la ficha sigue disponible.
          </p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            Reintentar este bloque
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
