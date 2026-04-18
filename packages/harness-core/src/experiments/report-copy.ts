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
    short: "Reparación",
    title: "Modo de reparación",
    noun: "reparación",
    nounPlural: "reparaciones"
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
  localization: "Cobertura de localización",
  patchApply: "Aplicación del parche"
};

const SCORE_DEFINITION_COPY: Record<ExperimentKind, BenchmarkScoreDefinition> = {
  qa: {
    modeDescription:
      "El modo guiado mide si el modelo completa escenarios definidos de principio a fin. La puntuación da más peso a terminar el escenario que a superar pasos aislados.",
    formula:
      "Puntuación = 100 x clamp(0.45 x Finalización del escenario + 0.25 x Éxito por paso + 0.15 x Éxito por capacidad + 0.15 x Estabilidad)",
    metrics: QA_SCORE_DEFINITION.metrics.map((metric) => {
      switch (metric.key) {
        case "scenarioCompletionRate":
          return {
            ...metric,
            label: "Finalización del escenario",
            description:
              "Porcentaje de escenarios guiados que terminan correctamente en los ensayos observados.",
            contribution:
              "Es el factor con más peso: completar el flujo entero es más importante que avanzar solo hasta la mitad."
          };
        case "stepPassRate":
          return {
            ...metric,
            label: "Éxito por paso",
            description:
              "Porcentaje de pasos superados sobre el total de pasos ejecutados.",
            contribution:
              "Permite ver progreso parcial cuando el escenario completo no llega a cerrarse."
          };
        case "capabilityPassRate":
          return {
            ...metric,
            label: "Éxito por capacidad",
            description:
              "Porcentaje de capacidades del benchmark cuyos escenarios se resuelven por completo.",
            contribution:
              "Premia la amplitud funcional y evita que un modelo destaque solo por repetir bien un flujo concreto."
          };
        case "stability":
          return {
            ...metric,
            label: "Estabilidad",
            description:
              "Consistencia entre ensayos, calculada a partir de la variación entre resultados correctos e incorrectos.",
            contribution:
              "Penaliza resultados que cambian mucho de una repetición a otra."
          };
        default:
          return metric;
      }
    }),
    specialRules: [
      "La estabilidad se calcula como 1 - (desviación típica binaria media / 0.5), con el resultado limitado al intervalo 0-1.",
      "La puntuación final se expresa en una escala de 0 a 100 después de aplicar las ponderaciones."
    ]
  },
  explore: {
    modeDescription:
      "El modo de exploración mide cuánta funcionalidad descubre el modelo y si esa exploración sirve para repetir escenarios después.",
    formula:
      "Puntuación = 100 x clamp(0.35 x Descubrimiento de capacidades + 0.20 x Cobertura de estados + 0.15 x Cobertura de transiciones + 0.10 x Diversidad de acciones + 0.20 x Reejecución de escenarios sonda)",
    metrics: EXPLORE_SCORE_DEFINITION.metrics.map((metric) => {
      switch (metric.key) {
        case "capabilityDiscoveryRate":
          return {
            ...metric,
            label: "Descubrimiento de capacidades",
            description:
              "Porcentaje de capacidades del benchmark que la exploración autónoma consigue identificar.",
            contribution:
              "Es el objetivo principal: descubrir funciones útiles pesa más que generar trazas largas pero repetitivas."
          };
        case "stateCoverage":
          return {
            ...metric,
            label: "Cobertura de estados",
            description:
              "Promedio de estados observados, normalizado con el objetivo mínimo configurado.",
            contribution:
              "Mide la amplitud de la navegación sin premiar en exceso secuencias repetidas."
          };
        case "transitionCoverage":
          return {
            ...metric,
            label: "Cobertura de transiciones",
            description:
              "Promedio de transiciones observadas, normalizado con el objetivo mínimo configurado.",
            contribution:
              "Distingue una exploración conectada de una simple acumulación de pantallas aisladas."
          };
        case "probeReplayPassRate":
          return {
            ...metric,
            label: "Reejecución de escenarios sonda",
            description:
              "Porcentaje de escenarios sonda que se resuelven al reutilizar los artefactos de exploración.",
            contribution:
              "Comprueba si lo descubierto se puede reutilizar, no solo si parece nuevo."
          };
        case "actionDiversity":
          return {
            ...metric,
            label: "Diversidad de acciones",
            description:
              "Porcentaje de tipos de acción esperados que aparecen en la traza de exploración.",
            contribution:
              "Añade una señal de variedad cuando ya se han medido cobertura y reutilización."
          };
        default:
          return metric;
      }
    }),
    specialRules: ["La cobertura de estados y transiciones se limita a 1.0 al alcanzar los objetivos definidos para la aplicación."]
  },
  heal: {
    modeDescription:
      "El modo de reparación mide si el modelo corrige fallos concretos sin romper comportamientos que ya funcionaban.",
    formula:
      "Puntuación = 100 x clamp(0.35 x Tasa de corrección completa + 0.30 x Corrección de escenarios fallidos + 0.15 x Ausencia de regresiones + 0.10 x Validación superada + 0.10 x Cobertura de localización)",
    metrics: [
      {
        key: "fixRate",
        label: "Tasa de corrección completa",
        weight: 0.35,
        description:
          "Porcentaje de casos que terminan con validación correcta, escenarios fallidos corregidos y sin regresiones.",
        contribution:
          "Es la señal principal porque resume si la reparación funciona de verdad."
      },
      {
        key: "failingScenarioFixRate",
        label: "Corrección de escenarios fallidos",
        weight: 0.3,
        description:
          "Porcentaje medio de escenarios inicialmente fallidos que quedan resueltos tras aplicar el parche.",
        contribution:
          "Mide avance real incluso cuando el caso completo todavía no queda resuelto."
      },
      {
        key: "regressionFreeRate",
        label: "Ausencia de regresiones",
        weight: 0.15,
        description:
          "Porcentaje medio de comprobaciones que siguen pasando después de la reparación.",
        contribution:
          "Evita contar como buena una reparación que arregla un fallo pero rompe otra parte."
      },
      {
        key: "validationPassRate",
        label: "Validación superada",
        weight: 0.1,
        description:
          "Porcentaje de casos en los que el comando de validación termina correctamente.",
        contribution:
          "Aporta una comprobación directa de que la solución supera el filtro de verificación."
      },
      {
        key: "localizationAccuracy",
        label: "Cobertura de localización",
        weight: 0.1,
        description:
          "Porcentaje medio de ficheros esperados del bug que aparecen entre los ficheros sospechosos propuestos.",
        contribution:
          "Valora la calidad del diagnóstico, aunque pesa menos que corregir el fallo."
      }
    ],
    specialRules: [
      "La aplicación del parche se muestra en tablas y auditorías, pero no entra en la puntuación ponderada.",
      "Cobertura de localización = |ficheros sospechosos ∩ ficheros esperados| / |ficheros esperados|."
    ]
  }
};

function countLabel(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

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
      subtitle: `Comparación consolidada de ${countLabel(input.runCount, "ejecución", "ejecuciones")} en ${countLabel(input.appCount, "aplicación", "aplicaciones")} y ${countLabel(input.modeCount, "modo", "modos")}.`
    };
  }

  if (input.variant === "benchmark-standardized") {
    return {
      title: "Tablas normalizadas del benchmark",
      subtitle: `Tablas comparables por modo y por aplicación para ${countLabel(input.runCount, "ejecución", "ejecuciones")}.`
    };
  }

  if (!input.modeKind) {
    return {
      title: "Informe de benchmark",
      subtitle: "Resultados disponibles organizados en matriz."
    };
  }

  const mode = modeCopy(input.modeKind);
  if (input.runCount === 1 && input.appId) {
    return {
      title: `Informe del ${mode.title.toLowerCase()} para ${input.appId}`,
      subtitle: `Resumen del ${mode.title.toLowerCase()} con ${countLabel(input.modelCount, "modelo", "modelos")}.`
    };
  }

  return {
    title: `Comparativa del ${mode.title.toLowerCase()}`,
    subtitle: `Comparación de ${countLabel(input.runCount, "ejecución", "ejecuciones")} del ${mode.title.toLowerCase()} en ${countLabel(input.appCount, "aplicación", "aplicaciones")}.`
  };
}

export function localizedModeReadGuide(kind: ExperimentKind): Array<{ title: string; body: string }> {
  const common = [
    {
      title: "Puntuación",
      body: "Cuanto más alta, mejor dentro de este modo. No debe compararse directamente con puntuaciones de otros modos."
    },
    {
      title: "Latencia de ejecución",
      body: "Cuanto más baja, mejor. Resume el tiempo medio de las ejecuciones mostradas."
    },
    {
      title: "Coste",
      body: "Cuanto más bajo, mejor. El coste medio es el gasto por ejecución; el coste total suma todo lo mostrado."
    }
  ];

  if (kind === "qa") {
    return [
      ...common,
      {
        title: "Qué mirar",
        body: "Prioriza escenarios completados y estabilidad. Las métricas por paso ayudan a explicar empates o fallos parciales."
      }
    ];
  }
  if (kind === "explore") {
    return [
      ...common,
      {
        title: "Qué mirar",
        body: "Prioriza capacidades descubiertas, cobertura y reutilización de la exploración en los escenarios sonda."
      }
    ];
  }
  return [
    ...common,
    {
      title: "Qué mirar",
      body: "Prioriza correcciones completas, escenarios fallidos resueltos y ausencia de regresiones. La aplicación del parche se muestra aparte."
    }
  ];
}

export function localizedComparisonGuide(): Array<{ title: string; body: string }> {
  return [
    {
      title: "Puntuación",
      body: "Cuanto más alta, mejor. Úsala solo para comparar resultados del mismo modo."
    },
    {
      title: "Cobertura",
      body: "Indica cuántas combinaciones tienen datos. Las ausencias no entran en medias ni totales."
    },
    {
      title: "Latencia y coste",
      body: "En ambos casos, un valor menor es mejor. Ayudan a valorar el resultado, pero no sustituyen a las métricas de eficacia."
    }
  ];
}

export function localizedSectionNotes(kind: ExperimentKind): string[] {
  if (kind === "qa") {
    return [
      "La estabilidad se calcula en el intervalo 0-1 a partir de la variación entre ensayos.",
      "Compara las puntuaciones del modo guiado solo con otras puntuaciones del modo guiado."
    ];
  }
  if (kind === "explore") {
    return [
      "La cobertura de estados y transiciones se limita a 1.0 al alcanzar el objetivo fijado para la aplicación.",
      "La reejecución de escenarios sonda mide si la exploración se puede reutilizar."
    ];
  }
  return [
    "La tasa de corrección completa es el factor con más peso en el modo de reparación.",
    "La aplicación del parche se muestra como indicador operativo, pero no cambia la puntuación ponderada."
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
