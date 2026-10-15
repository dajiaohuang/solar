const axes = ['x', 'y', 'z', 'vx', 'vy', 'vz']
const unit = (index: number) => index < 3 ? 'AU' : 'AU/day'

/** Display report values without deriving new covariance or confidence levels. */
export function CartesianStateTable({ state, covariance, title, zh }: {
  state: readonly number[]; covariance: readonly (readonly number[])[]; title: string; zh: boolean
}) {
  const valid = state.length === 6 && state.every(Number.isFinite) && covariance.length === 6 &&
    covariance.every(row => row.length === 6 && row.every(Number.isFinite))
  return <details>
    <summary>{title}</summary>
    {!valid ? <p role="status">{zh ? '六维状态或协方差不可显示。' : 'The six-component state or covariance is unavailable.'}</p> : <>
      <p>{zh ? '日心 J2000 黄道坐标；位置为 AU，速度为 AU/天。协方差各项的单位为行单位乘列单位。以下是报告原值，显示位数不代表物理精度。' : 'Heliocentric J2000 ecliptic coordinates: position in AU and velocity in AU/day. Each covariance entry has the row unit multiplied by the column unit. These are report values; displayed digits do not establish physical accuracy.'}</p>
      <div className="uncertainty-table"><table><caption>{zh ? '六维状态' : 'Six-component state'}</caption>
        <thead><tr><th>{zh ? '分量' : 'Component'}</th><th>{zh ? '值' : 'Value'}</th><th>{zh ? '单位' : 'Unit'}</th></tr></thead>
        <tbody>{axes.map((axis, index) => <tr key={axis}><th scope="row">{axis}</th><td>{state[index].toPrecision(12)}</td><td>{unit(index)}</td></tr>)}</tbody>
      </table></div>
      <div className="uncertainty-table"><table><caption>{zh ? '完整六维协方差' : 'Complete six-component covariance'}</caption>
        <thead><tr><th>{zh ? '行 / 列' : 'Row / column'}</th>{axes.map((axis, index) => <th scope="col" key={axis}>{axis}<small>{unit(index)}</small></th>)}</tr></thead>
        <tbody>{axes.map((axis, index) => <tr key={axis}><th scope="row">{axis}<small>{unit(index)}</small></th>{covariance[index].map((value, column) => <td key={column}>{value.toExponential(6)}</td>)}</tr>)}</tbody>
      </table></div>
    </>}
  </details>
}
