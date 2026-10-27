import type { StoredData } from '../types'
import { Card, TabHeader, TAB_BADGES } from '../components/ui'
import ImportBackup from '../components/ImportBackup'
import ImportIpv from '../components/ImportIpv'

/**
 * Importar — pantalla propia (D-R5-03, 26-oct).
 *
 * Hasta esta oleada la entrada «Importar» abría Sistema (donde la
 * importación vivía embebida en su tarjeta de cierre) y el dueño lo
 * reportó como defecto («Cuando abro Importar me sale Sistema»):
 * en el original Importar es su pestaña («Subir Excel diario del
 * IPV», insignia «Excel diario del IPV»).
 *
 * La pantalla reúne las dos vías de entrada de datos del sistema
 * con los mismos componentes que ya vivían en Sistema — importar
 * el Excel diario del IPV (con su reconciliación de vuelta) e
 * importar un respaldo del SDA — sin duplicar lógica. Sistema
 * conserva el estado de los respaldos y un acceso a esta pantalla.
 */
export default function Importar({ data, canWrite, onChanged }: {
  data: StoredData
  canWrite: boolean
  onChanged: () => void
}) {
  return (
    <section>
      <TabHeader
        icon="upload"
        title="Importar"
        desc="Subir Excel diario del IPV"
        badge={TAB_BADGES.importar}
      />
      {!canWrite ? (
        <Card>
          <h3 style={{ marginTop: 0 }}>Solo lectura</h3>
          <p className="sub" style={{ margin: 0 }}>
            Tu rol puede consultar el sistema, pero importar datos (el IPV del día o un
            respaldo) queda para los roles con escritura. Lo importado se ve en Días,
            Inicio y el resto de pantallas.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <p className="eyebrow">IPV diario · Excel</p>
            <h2>Importar IPV del día</h2>
            <p className="sub">
              El Excel diario del IPV: al subirlo, el sistema lo procesa, lo compara y lo
              cuadra agregando lo que le falta (RH, coctelería, pizzería, entradas y
              almacén) SIN modificar sus cifras, y devuelve el IPV cuadrado.
            </p>
            <ImportIpv onImported={onChanged} existingDays={data.days} data={data} bare />
          </Card>
          <Card>
            <p className="eyebrow">Respaldo · Ida y vuelta</p>
            <h2>Importar respaldo del SDA</h2>
            <p className="sub">
              Un respaldo exportado desde Documentos (formato {'{'}backupOf, exportedAt,
              data{'}'}) reproduce los mismos totales: días, cuentas, gastos, nóminas,
              trabajadores y transferencias.
            </p>
            <ImportBackup onImported={onChanged} bare />
          </Card>
        </>
      )}
    </section>
  )
}
