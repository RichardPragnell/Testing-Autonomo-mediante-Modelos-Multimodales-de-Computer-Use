# Orquestacion y configuracion del benchmark

## Descripcion de la solucion

Se ha desarrollado un modulo de orquestacion encargado de coordinar la ejecucion de los distintos experimentos del benchmark. Este modulo se concentra principalmente en el paquete `harness-core`, que actua como nucleo reutilizable de la aplicacion. Desde este nucleo se resuelven los objetivos disponibles, se cargan los manifiestos, se seleccionan los modelos, se preparan los espacios de trabajo y se invocan los modos de ejecucion definidos para el proyecto.

La orquestacion permite ejecutar tres familias principales de experimentos: ejecucion guiada, exploracion autonoma y autorreparacion. Tambien permite lanzar la suite completa, reconstruir informes a partir de artefactos guardados y comparar ejecuciones previas. Esta organizacion evita que cada modo experimental implemente su propia logica de preparacion, seleccion y persistencia, lo que reduce duplicidades y facilita la trazabilidad.

## Metodologia aplicada

Se ha seguido una metodologia basada en manifiestos declarativos. Cada aplicacion benchmark declara su configuracion mediante archivos JSON, como `target.json` y `benchmark.json`. Esta informacion se carga en tiempo de ejecucion y se transforma en una suite resuelta, lista para ser ejecutada por el orquestador.

El uso de manifiestos permite separar la definicion del experimento de su ejecucion. La aplicacion define que escenarios, capacidades, fallos y comandos de validacion existen. El orquestador decide como preparar una ejecucion concreta, que modelos intervienen, cuantos ensayos se realizan y donde se guardan los artefactos.

Tambien se ha incluido control de concurrencia. El sistema puede ejecutar varios modelos en paralelo dentro de una aplicacion y, cuando se omite una aplicacion concreta, puede distribuir el trabajo entre varias implementaciones benchmark. Esta capacidad se configura mediante parametros como `parallelism` y `appParallelism`, y permite adaptar la ejecucion a los recursos disponibles sin alterar la definicion metodologica del benchmark.

## Herramientas, tecnologias y modelos empleados

El modulo se ha implementado en TypeScript sobre Node.js. Se utiliza pnpm como gestor de paquetes y monorepo. La seleccion de modelos se realiza a partir de `experiments/models/registry.yaml`, donde se indica el identificador del modelo, el proveedor y si se encuentra habilitado.

La integracion con proveedores de modelos se canaliza mediante OpenRouter, lo que permite usar distintos modelos sin modificar la logica principal del benchmark. Esta decision desacopla la evaluacion de una API concreta y facilita que el sistema se mantenga vigente ante la aparicion de nuevos modelos.

El entorno se configura mediante variables como `OPENROUTER_API_KEY` y, opcionalmente, `OPENROUTER_BASE_URL`. El repositorio incluye una plantilla `.env.example`, y el nucleo del sistema carga estas variables desde el entorno local. Esta configuracion permite distinguir entre validaciones tecnicas que no requieren llamadas reales a modelos y ejecuciones experimentales que si las requieren.

## Flujo de datos y artefactos tratados

El proceso comienza con la seleccion de una aplicacion o de un conjunto de aplicaciones. A continuacion, se carga el manifiesto correspondiente, se resuelven los escenarios y fallos solicitados, se prepara una copia de trabajo a partir de la plantilla y se reserva la configuracion local necesaria para iniciar la Application Under Test (AUT), o aplicacion sometida a prueba.

Durante la ejecucion se generan identificadores de run, rutas de artefactos, informes en JavaScript Object Notation (JSON) e informes en HyperText Markup Language (HTML). La informacion se almacena bajo el directorio `results`, separado por modo de experimento. Esta estructura permite conservar tanto los datos completos de una ejecucion como los resumenes preparados para comparacion posterior.

El orquestador tambien reconstruye informes a partir de datos ya guardados. Esta capacidad es importante porque permite regenerar vistas comparativas sin repetir llamadas a modelos ni volver a ejecutar las aplicaciones. De esta forma, la fase de analisis puede separarse de la fase de captura experimental.

## Papel dentro del sistema completo

La orquestacion conecta todos los modulos. Recibe la configuracion del contrato y las aplicaciones benchmark, invoca el runner de automatizacion, coordina la exploracion y la autorreparacion, y entrega los artefactos que seran consumidos por el modulo de informes.

Este modulo tambien establece una capa de estabilidad operativa. Al centralizar la preparacion de workspaces, la seleccion de modelos y la gestion de salidas, se reduce el riesgo de que cada experimento se ejecute bajo condiciones distintas. Por ello, la orquestacion se considera una pieza esencial para que el benchmark sea repetible, extensible y mantenible.
