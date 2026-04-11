# Analisis de resultados y generacion de informes

## Descripcion de la solucion

Se ha desarrollado un modulo de analisis y generacion de informes para transformar las ejecuciones del benchmark en artefactos consultables. Este modulo no ejecuta la aplicacion ni interactua directamente con el navegador. Su funcion consiste en leer datos producidos por los experimentos, estructurarlos, calcular metricas y generar informes en formatos adecuados para revision tecnica y academica.

La solucion genera informes en JavaScript Object Notation (JSON) para conservar datos estructurados y en HyperText Markup Language (HTML) para facilitar la lectura visual. Los informes HTML se renderizan con redaccion formal en espanol, mientras que las claves internas de los artefactos JSON se mantienen en ingles por compatibilidad con herramientas y codigo del proyecto.

## Metodologia aplicada

Se ha seguido una metodologia de separacion entre captura experimental y analisis. Los modos de ejecucion guardan artefactos completos y resumenes. Posteriormente, el modulo de informes puede reconstruir comparativas a partir de esos datos sin volver a ejecutar el benchmark. Esta separacion permite repetir el analisis, ajustar la presentacion o regenerar paginas HTML sin consumir nuevas llamadas a modelos.

El sistema organiza las metricas por familia de experimento. En ejecucion guiada se contemplan aspectos como finalizacion de escenarios, cumplimiento de capacidades, estabilidad, latencia y coste. En exploracion autonoma se consideran aspectos como cobertura de capacidades, estados descubiertos, transiciones, diversidad de acciones y replay de escenarios de prueba. En autorreparacion se contemplan aspectos como reparacion, localizacion, aplicacion de parches, validacion posterior y ausencia de regresiones.

No se incluyen valores reales en este documento. Las metricas se describen como parte de la infraestructura preparada para el analisis futuro, una vez ejecutada la suite completa de benchmarks.

## Herramientas, tecnologias y modelos empleados

El modulo se ha implementado en TypeScript dentro de `packages/harness-core/src/experiments`. Incluye componentes para puntuacion, comparacion, construccion de tablas, generacion de graficos y renderizado de informes. Vitest se utiliza para validar partes del calculo de puntuaciones, matrices e informes.

Las visualizaciones se generan como parte de documentos HTML estaticos. Esto permite abrir los informes sin depender de un servidor web o de una aplicacion adicional. Tambien se generan informes comparativos de modo, informes finales del benchmark e informes estandarizados organizados por modo y aplicacion.

El sistema registra informacion de uso de inteligencia artificial cuando esta disponible. Esta informacion puede incluir tokens de entrada, tokens de salida, tokens de razonamiento, latencia, coste y origen del coste. La presencia de esta informacion depende del proveedor y de la respuesta recibida mediante OpenRouter.

## Flujo de datos y artefactos tratados

El flujo parte de los artefactos guardados bajo `results`. Cada modo experimental genera una estructura de runs e informes. Los runs contienen informacion detallada de la ejecucion, mientras que los informes resumen datos relevantes para comparacion.

El comando de reconstruccion revisa los informes existentes y aplica una politica de seleccion basada en el ultimo informe disponible por modo, aplicacion y modelo. Esta politica permite generar comparativas consolidadas cuando existen multiples ejecuciones guardadas. Tambien se conserva informacion de procedencia para indicar que informes han sido utilizados en una comparacion.

Los informes finales pueden incluir tablas de auditoria, resumenes por modelo, definiciones de puntuacion, graficos de coste y matrices comparativas. Estas salidas estan preparadas para apoyar la seccion de resultados de la memoria, pero los valores concretos deberan incorporarse despues de ejecutar la suite completa y revisar los artefactos generados.

## Papel dentro del sistema completo

El modulo de analisis convierte ejecuciones tecnicas en informacion interpretable. Sin este modulo, el benchmark produciria datos utiles pero dispersos. Con el sistema de informes, las evidencias quedan organizadas por modo, modelo, aplicacion y metrica.

Este modulo se relaciona con todos los demas subsistemas. Recibe datos de ejecucion guiada, exploracion y autorreparacion; utiliza la configuracion de modelos y aplicaciones para etiquetar resultados; y proporciona salidas que pueden integrarse en la memoria. Su funcion es preparar el puente entre la ejecucion experimental y la interpretacion academica posterior, sin adelantar conclusiones antes de disponer de datos completos.
