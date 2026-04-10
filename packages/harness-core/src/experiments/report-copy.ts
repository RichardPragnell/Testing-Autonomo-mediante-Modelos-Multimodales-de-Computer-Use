import {
  EXPLORE_SCORE_DEFINITION,
  HEAL_SCORE_DEFINITION,
  QA_SCORE_DEFINITION
} from "./scoring.js";
import type { BenchmarkScoreDefinition, ExperimentKind } from "./types.js";

export type HtmlReportVariant = "mode" | "benchmark-final" | "benchmark-standardized";

type ModeCopy = {
  short: string;
  title: string;
  noun: string;
  nounPlural: string;
};

const MODE_COPY: Record<ExperimentKind, ModeCopy> = {
  qa: {
    short: "Guiado",
    title: "Modo guiado",
    noun: "guiado",
    nounPlural: "guiados"
  },
  explore: {
    short: "Exploración",
    title: "Modo de exploración",
    noun: "exploración",
    nounPlural: "exploraciones"
  },
  heal: {
    short: "Autorreparación",
    title: "Modo de autorreparación",
    noun: "autorreparación",
    nounPlural: "autorreparaciones"
  }
};

const METRIC_LABELS: Record<string, string> = {
  score: "Puntuación",
  stepPassRate: "Éxito por paso",
  scenarioCompletion: "Finalización del escenario",
  capabilityPassRate: "Éxito por capacidad",
  stability: "Estabilidad",
  avgLatency: "Latencia de ejecución",
  avgCost: "Coste medio",
  totalCost: "Coste total",
  capabilityDiscovery: "Descubrimiento de capacidades",
  stateCoverage: "Cobertura de estados",
  transitionCoverage: "Cobertura de transiciones",
  probeReplay: "Reejecución de escenarios sonda",
  actionDiversity: "Diversidad de acciones",
  fixRate: "Tasa de corrección completa",
  failingScenarioFix: "Corrección de escenarios fallidos",
  regressionFree: "Ausencia de regresiones",
  validationPass: "Validación superada",
  localization: "Recall de localización",
  patchApply: "Aplicación del parche"
};

const SCORE_DEFINITION_COPY: Record<ExperimentKind, BenchmarkScoreDefinition> = {
  qa: {
    modeDescription:
      "El modo guiado prioriza la finalización íntegra del escenario y, en segundo término, la consistencia y la eficiencia operativa.",
    formula:
      "Puntuación = 100 x clamp(0.44 x Finalización del escenario + 0.24 x Éxito por paso + 0.12 x Éxito por capacidad + 0.15 x Estabilidad + 0.03 x Eficiencia de latencia de ejecución + 0.02 x Eficiencia de coste)",
    metrics: QA_SCORE_DEFINITION.metrics.map((metric) => {
      switch (metric.key) {
        case "scenarioCompletionRate":
          return {
            ...metric,
            label: "Finalización del escenario",
            description:
              "Proporción de escenarios guiados que concluyen satisfactoriamente en el conjunto de ensayos observados.",
            contribution:
              "Es el término dominante porque una ejecución parcialmente correcta no debe superar a otra que completa el escenario de extremo a extremo."
          };
        case "stepPassRate":
          return {
            ...metric,
            label: "Éxito por paso",
            description:
              "Proporción de pasos guiados superados sobre el total de pasos ejecutados en todos los ensayos.",
            contribution:
              "Aporta granularidad analítica cuando el escenario completo no llega a cerrarse, pero el comportamiento sigue mostrando señales útiles."
          };
        case "capabilityPassRate":
          return {
            ...metric,
            label: "Éxito por capacidad",
            description:
              "Proporción de capacidades del benchmark cuyos escenarios agrupados se resuelven de forma completa.",
            contribution:
              "Favorece la amplitud funcional y evita que un modelo destaque solo por repetir con éxito una trayectoria estrecha."
          };
        case "stability":
          return {
            ...metric,
            label: "Estabilidad",
            description:
              "Consistencia entre ensayos, normalizada en el intervalo 0-1 a partir de la desviación típica de resultados binarios por escenario.",
            contribution:
              "Penaliza la variabilidad entre repeticiones y refuerza la lectura de robustez experimental."
          };
        case "latencyEfficiency":
          return {
            ...metric,
            label: "Eficiencia de latencia de ejecución",
            description:
              "Término de eficiencia calculado a partir de la latencia media de ejecución y del pivote compartido de latencia.",
            contribution:
              "Introduce una preferencia secundaria por ejecuciones más ágiles cuando la calidad funcional es similar."
          };
        default:
          return {
            ...metric,
            label: "Eficiencia de coste",
            description:
              "Término de eficiencia calculado a partir del coste medio resuelto y del pivote compartido de coste.",
            contribution:
              "Favorece soluciones menos costosas sin desplazar la evidencia funcional."
          };
      }
    }),
    specialRules: [
      "La estabilidad se normaliza como 1 - (desviación típica binaria media / 0.5), de modo que el intervalo efectivo vuelve a ser 0-1.",
      "Eficiencia de latencia de ejecución = 1 / (1 + avgLatencyMs / 2000).",
      "Eficiencia de coste = 1 / (1 + avgCostUsd / 0.05).",
      "Una mayor puntuación indica mejor rendimiento; la puntuación final se acota al intervalo 0-100 tras ponderar los términos."
    ]
  },
  explore: {
    modeDescription:
      "El modo de exploración valora la cobertura útil del sistema, la reutilización de lo descubierto y, en un plano secundario, la eficiencia operativa.",
    formula:
      "Puntuación = 100 x clamp(0.3375 x Descubrimiento de capacidades + 0.1875 x Cobertura de estados + 0.15 x Cobertura de transiciones + 0.075 x Diversidad de acciones + 0.20 x Reejecución de escenarios sonda + 0.03 x Eficiencia de latencia de ejecución + 0.02 x Eficiencia de coste)",
    metrics: EXPLORE_SCORE_DEFINITION.metrics.map((metric) => {
      switch (metric.key) {
        case "capabilityDiscoveryRate":
          return {
            ...metric,
            label: "Descubrimiento de capacidades",
            description:
              "Proporción de capacidades del benchmark que la exploración autónoma consigue aflorar.",
            contribution:
              "Constituye el objetivo principal, porque descubrir funcionalidades útiles es más relevante que aumentar el volumen de trazas sin contenido analítico."
          };
        case "stateCoverage":
          return {
            ...metric,
            label: "Cobertura de estados",
            description:
              "Número medio de estados observados, normalizado respecto al umbral heurístico mínimo configurado.",
            contribution:
              "Mide la amplitud de la superficie navegada y evita sobrerrepresentar secuencias repetitivas."
          };
        case "transitionCoverage":
          return {
            ...metric,
            label: "Cobertura de transiciones",
            description:
              "Número medio de transiciones observadas, normalizado respecto al objetivo heurístico mínimo configurado.",
            contribution:
              "Captura la riqueza de la navegación y distingue la exploración verdaderamente conectada de la acumulación de instantáneas aisladas."
          };
        case "probeReplayPassRate":
          return {
            ...metric,
            label: "Reejecución de escenarios sonda",
            description:
              "Proporción de escenarios sonda que se resuelven al reejecutarlos desde los artefactos obtenidos en exploración.",
            contribution:
              "Evalúa la utilidad práctica de lo descubierto y no solo su novedad aparente."
          };
        case "actionDiversity":
          return {
            ...metric,
            label: "Diversidad de acciones",
            description:
              "Fracción de tipos de acción esperados que aparecen en la traza de exploración.",
            contribution:
              "Aporta una señal complementaria de variedad conductual una vez cubiertos los objetivos principales de cobertura y reutilización."
          };
        case "latencyEfficiency":
          return {
            ...metric,
            label: "Eficiencia de latencia de ejecución",
            description:
              "Término de eficiencia calculado a partir de la latencia media de ejecución y del pivote compartido de latencia.",
            contribution:
              "Favorece exploraciones más ligeras cuando el rendimiento sustantivo es equivalente."
          };
        default:
          return {
            ...metric,
            label: "Eficiencia de coste",
            description:
              "Término de eficiencia calculado a partir del coste medio resuelto y del pivote compartido de coste.",
            contribution:
              "Introduce una preferencia secundaria por exploraciones menos costosas."
          };
      }
    }),
    specialRules: [
      "La cobertura de estados y de transiciones se trunca en 1.0 tras normalizarse frente a los objetivos heurísticos definidos para la aplicación.",
      "Eficiencia de latencia de ejecución = 1 / (1 + avgLatencyMs / 2000).",
      "Eficiencia de coste = 1 / (1 + avgCostUsd / 0.05)."
    ]
  },
  heal: {
    modeDescription:
      "El modo de autorreparación prioriza la corrección efectiva del caso defectuoso, la ausencia de regresiones y la calidad diagnóstica, reservando las señales operativas para una lectura complementaria.",
    formula:
      "Puntuación = 100 x clamp(0.33 x Tasa de corrección completa + 0.27 x Corrección de escenarios fallidos + 0.15 x Ausencia de regresiones + 0.10 x Validación superada + 0.10 x Recall de localización + 0.03 x Eficiencia de latencia de ejecución + 0.02 x Eficiencia de coste)",
    metrics: [
      {
        key: "fixRate",
        label: "Tasa de corrección completa",
        weight: 0.33,
        description:
          "Proporción de casos de reparación que terminan con validación satisfactoria, corrección total de los escenarios fallidos y ausencia de regresiones.",
        contribution:
          "Es la señal principal, porque sintetiza el éxito integral del proceso de autorreparación."
      },
      {
        key: "failingScenarioFixRate",
        label: "Corrección de escenarios fallidos",
        weight: 0.27,
        description:
          "Fracción media de escenarios inicialmente defectuosos que quedan resueltos tras aplicar el parche.",
        contribution:
          "Recoge la capacidad de reparación incluso cuando la corrección completa del caso aún no se alcanza."
      },
      {
        key: "regressionFreeRate",
        label: "Ausencia de regresiones",
        weight: 0.15,
        description:
          "Fracción media de comprobaciones de regresión que siguen siendo válidas después de la intervención.",
        contribution:
          "Evita que una reparación aparente se interprete como positiva si deteriora comportamiento previamente correcto."
      },
      {
        key: "validationPassRate",
        label: "Validación superada",
        weight: 0.1,
        description:
          "Proporción de casos en los que el comando de validación finaliza satisfactoriamente.",
        contribution:
          "Introduce una evidencia operativa directa de que la solución propuesta soporta el filtro de verificación."
      },
      {
        key: "localizationAccuracy",
        label: "Recall de localización",
        weight: 0.1,
        description:
          "Proporción media de ficheros oro del bug que aparecen recuperados entre los ficheros sospechosos propuestos por el sistema.",
        contribution:
          "Valora la calidad del diagnóstico, pero con un peso inferior al éxito efectivo de la reparación."
      },
      {
        key: "latencyEfficiency",
        label: "Eficiencia de latencia de ejecución",
        weight: 0.03,
        description:
          "Término de eficiencia calculado a partir de la latencia media de ejecución y del pivote compartido de latencia.",
        contribution:
          "Aporta una preferencia secundaria por ciclos de reparación más ágiles."
      },
      {
        key: "costEfficiency",
        label: "Eficiencia de coste",
        weight: 0.02,
        description:
          "Término de eficiencia calculado a partir del coste medio resuelto y del pivote compartido de coste.",
        contribution:
          "Favorece procesos menos costosos una vez fijadas las prioridades de efectividad."
      }
    ],
    specialRules: [
      "La aplicación del parche se mantiene como indicador operativo en tablas y auditorías, pero no forma parte de la puntuación ponderada.",
      "Recall de localización = |ficheros sospechosos ∩ ficheros oro| / |ficheros oro|.",
      "Eficiencia de latencia de ejecución = 1 / (1 + avgLatencyMs / 2000).",
      "Eficiencia de coste = 1 / (1 + avgCostUsd / 0.05)."
    ]
  }
};

export function modeCopy(kind: ExperimentKind): ModeCopy {
  return MODE_COPY[kind];
}

export function spanishMetricLabel(key: string, fallbackLabel: string): string {
  return METRIC_LABELS[key] ?? fallbackLabel;
}

export function spanishScoreDefinition(kind: ExperimentKind): BenchmarkScoreDefinition {
  return SCORE_DEFINITION_COPY[kind];
}

export function reportHeaderCopy(input: {
  variant: HtmlReportVariant;
  modeKind?: ExperimentKind;
  appId?: string;
  modelCount: number;
  runCount: number;
  appCount: number;
  modeCount: number;
}): { title: string; subtitle: string } {
  if (input.variant === "benchmark-final") {
    return {
      title: "Informe final del benchmark",
      subtitle: `Comparación consolidada de ${String(input.runCount)} ejecuciones en ${String(input.appCount)} aplicaciones y ${String(input.modeCount)} modos.`
    };
  }

  if (input.variant === "benchmark-standardized") {
    return {
      title: "Tablas normalizadas del benchmark",
      subtitle: `Vista homogénea por modo y comparación por aplicación para ${String(input.runCount)} ejecuciones disponibles.`
    };
  }

  if (!input.modeKind) {
    return {
      title: "Informe de benchmark",
      subtitle: "Síntesis matricial de los resultados disponibles."
    };
  }

  const mode = modeCopy(input.modeKind);
  if (input.runCount === 1 && input.appId) {
    return {
      title: `Informe del ${mode.title.toLowerCase()} para ${input.appId}`,
      subtitle: `Síntesis matricial del experimento correspondiente al ${mode.title.toLowerCase()} para ${String(input.modelCount)} modelo(s).`
    };
  }

  return {
    title: `Comparativa del ${mode.title.toLowerCase()}`,
    subtitle: `Comparación matricial de ${String(input.runCount)} ejecución(es) correspondientes al ${mode.title.toLowerCase()} en ${String(input.appCount)} aplicación(es).`
  };
}

export function localizedModeReadGuide(kind: ExperimentKind): Array<{ title: string; body: string }> {
  const common = [
    {
      title: "Puntuación",
      body: "Un valor más alto indica mejor rendimiento dentro del modo analizado; la puntuación combina resultados sustantivos y eficiencia en una escala 0-100."
    },
    {
      title: "Latencia de ejecución",
      body: "Un valor más bajo es preferible. La latencia resume el tiempo medio observado en las ejecuciones mostradas."
    },
    {
      title: "Coste",
      body: "Un valor más bajo es preferible. El coste medio resume el gasto por ejecución, mientras que el coste total agrega el gasto del alcance mostrado."
    }
  ];

  if (kind === "qa") {
    return [
      ...common,
      {
        title: "Lectura sustantiva",
        body: "La interpretación debe priorizar la finalización completa del escenario y la estabilidad; las métricas auxiliares solo refinan empates cercanos."
      }
    ];
  }
  if (kind === "explore") {
    return [
      ...common,
      {
        title: "Lectura sustantiva",
        body: "La lectura debe centrarse en el descubrimiento de capacidades, la cobertura alcanzada y la posibilidad de reutilizar la exploración mediante escenarios sonda."
      }
    ];
  }
  return [
    ...common,
    {
      title: "Lectura sustantiva",
      body: "La interpretación debe priorizar la corrección completa del caso, la reparación de los escenarios fallidos y la ausencia de regresiones; la aplicación del parche se informa aparte."
    }
  ];
}

export function localizedComparisonGuide(): Array<{ title: string; body: string }> {
  return [
    {
      title: "Puntuación",
      body: "Un valor más alto indica mejor rendimiento, pero las puntuaciones brutas solo deben compararse dentro del mismo modo."
    },
    {
      title: "Rango",
      body: "Un valor más bajo indica mejor posición relativa. El rango sintetiza la ordenación por modo y aplicación."
    },
    {
      title: "Cobertura",
      body: "La cobertura informa de cuántas celdas contienen resultados observados. Las ausencias no se incorporan a medias ni totales."
    },
    {
      title: "Latencia y coste",
      body: "Ambas magnitudes se interpretan a la baja. Sirven para contextualizar las diferencias de eficacia, no para sustituirlas."
    }
  ];
}

export function localizedSectionNotes(kind: ExperimentKind): string[] {
  if (kind === "qa") {
    return [
      "La estabilidad se normaliza sobre todo el intervalo 0-1 a partir de la variabilidad binaria entre ensayos.",
      "La comparación principal debe establecerse dentro del modo guiado."
    ];
  }
  if (kind === "explore") {
    return [
      "La cobertura de estados y transiciones se satura en 1.0 al alcanzar el umbral heurístico fijado para la aplicación.",
      "La reejecución de escenarios sonda mide la utilidad práctica de la exploración y no solo su amplitud."
    ];
  }
  return [
    "La tasa de corrección completa es la señal dominante de la puntuación en autorreparación.",
    "La aplicación del parche se informa como indicador operativo, pero no altera la puntuación ponderada."
  ];
}

export function localizedCostBadge(kind: "no_ai_calls" | "estimated" | "partial" | "unavailable"): string {
  switch (kind) {
    case "no_ai_calls":
      return "Sin llamadas a IA";
    case "estimated":
      return "Estimado";
    case "partial":
      return "Parcial";
    case "unavailable":
      return "No disponible";
  }
}
