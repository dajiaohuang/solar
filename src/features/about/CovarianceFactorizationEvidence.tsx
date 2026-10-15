import type { factorSbdbCovariance } from '../../engine/ephemeris/covarianceSampling'

type Evidence = ReturnType<typeof factorSbdbCovariance>['factorization']

export function CovarianceFactorizationEvidence({ evidence, zh }: { evidence: Evidence; zh: boolean }) {
  return <details>
    <summary>{zh ? '查看源协方差分解核对' : 'Inspect source covariance factorization'}</summary>
    <dl>
      <dt>{zh ? '源参数维数' : 'Source parameter dimension'}</dt><dd>{evidence.dimension}</dd>
      <dt>{zh ? '相关矩阵对称性容差' : 'Correlation symmetry tolerance'}</dt><dd>{evidence.correlationSymmetryTolerance.toExponential(5)}</dd>
      <dt>{zh ? '最大转置差异' : 'Maximum transpose difference'}</dt><dd>{evidence.maximumCorrelationAsymmetry.toExponential(5)}</dd>
      <dt>{zh ? '最大重建残差' : 'Maximum reconstruction residual'}</dt><dd>{evidence.maximumCorrelationReconstructionResidual.toExponential(5)}</dd>
    </dl>
    <p>{zh ? '后三项为相关矩阵上的无量纲量。仅对容差内的转置差异取平均，原始源矩阵保留；不加对角扰动或裁剪特征值。重建残差是同一算术路径的一致性诊断，不是条件数、精度界、统计校准或独立验证。完整分解约定随结果导出。' : 'The last three quantities are dimensionless correlation-matrix diagnostics. Transpose differences are averaged only within tolerance; the original source matrix is retained. No diagonal jitter or eigenvalue clipping is applied. Reconstruction residual is a same-arithmetic consistency diagnostic, not a condition number, accuracy bound, statistical calibration or independent validation. Exports retain the complete factorization convention.'}</p>
  </details>
}
