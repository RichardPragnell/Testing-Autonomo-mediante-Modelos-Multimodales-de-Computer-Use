# Ejecucion guiada con Stagehand

## Descripcion de la solucion

Se ha desarrollado un modulo de ejecucion guiada para evaluar si un modelo de inteligencia artificial puede completar escenarios funcionales previamente definidos. Este modo se apoya en Stagehand como herramienta de automatizacion de navegador orientada a agentes. La ejecucion se realiza sobre una aplicacion local, levantada desde una copia limpia de la plantilla benchmark.

El objetivo de este modulo no es explorar libremente la interfaz, sino seguir instrucciones concretas asociadas a escenarios conocidos. Cada escenario contiene pasos, acciones esperadas y aserciones. Las acciones indican que debe hacerse en la interfaz, por ejemplo escribir una nueva tarea o pulsar un boton. Las aserciones verifican que el estado visible de la aplicacion coincide con lo esperado.

## Metodologia aplicada

Se ha aplicado una metodologia de validacion basada en escenarios. Cada escenario representa una capacidad funcional de la aplicacion Todo: carga inicial, creacion de tareas, completado, filtrado, edicion y eliminacion. La division en escenarios permite medir de forma independiente que flujos se han completado y en que punto se ha producido una desviacion.

Durante una ejecucion guiada, el sistema prepara la suite resuelta, inicia la Application Under Test (AUT) y entrega al runner la configuracion del modelo, el prompt guiado y los limites de ejecucion. Entre estos limites se incluyen el tiempo maximo por escenario, el numero de reintentos, el numero maximo de pasos y el tamano de viewport.

El prompt guiado se ha definido para que el agente complete la tarea visible con la minima navegacion necesaria y capture el resultado antes de declarar exito. Esta instruccion favorece una interaccion centrada en el objetivo y evita que el modelo realice acciones innecesarias que puedan alterar el estado de la prueba.

## Herramientas, tecnologias y modelos empleados

Stagehand se utiliza en modo local. El navegador se ejecuta en la maquina del proyecto y no depende de Browserbase cloud. Esta decision permite controlar mejor el entorno de ejecucion y mantener el benchmark centrado en una infraestructura reproducible.

El modelo de lenguaje se accede mediante OpenRouter. La configuracion de modelos se obtiene del registro del proyecto, y el runner utiliza el modelo seleccionado para interpretar instrucciones, observar la interfaz y ejecutar acciones. Las llamadas al modelo pueden registrar informacion de uso, tokens, latencia y coste estimado o exacto cuando el proveedor lo permite.

El modulo esta implementado en TypeScript dentro de `packages/harness-core`. Las funciones de ejecucion guiada se apoyan en tipos compartidos para representar escenarios, pasos, aserciones, trazas, capturas y resumenes de uso. Este enfoque facilita que los datos producidos por la ejecucion puedan ser tratados posteriormente por el modulo de informes.

## Flujo de datos y evidencias tratadas

La ejecucion comienza con un conjunto de escenarios seleccionados desde el manifiesto de benchmark. Cada escenario se transforma en una unidad ejecutable. Para cada paso, el runner puede realizar una accion sobre la interfaz y despues ejecutar una o varias aserciones. Las aserciones pueden consistir en observar si existe un elemento o extraer un valor visible de la pantalla.

Cuando un paso falla, se registran datos utiles para el diagnostico. Entre estos datos pueden incluirse mensajes de error, trazas de operaciones, estado de la URL, capturas de pantalla o informacion extraida del Document Object Model (DOM), es decir, la estructura de elementos de la pagina. Estos artefactos no se interpretan como resultados finales en esta documentacion, sino como evidencias que la suite podra utilizar en la fase de analisis.

El modulo tambien incorpora mecanismos de cache. Cuando una observacion o accion ya ha sido resuelta bajo una configuracion compatible, el sistema puede reutilizar informacion previa para reducir llamadas repetidas al modelo. Esta reutilizacion debe mantenerse controlada mediante firmas de configuracion para evitar mezclar ejecuciones no equivalentes.

## Papel dentro del sistema completo

La ejecucion guiada proporciona una forma estructurada de validar comportamientos conocidos. Sus salidas alimentan la comparacion entre modelos, el analisis de estabilidad y, en caso de fallos, el modulo de diagnostico y autorreparacion.

Este modulo se relaciona directamente con el contrato funcional, ya que los escenarios guiados proceden de esa definicion comun. Tambien se relaciona con el modulo de informes, que transforma las ejecuciones guardadas en tablas, metricas y visualizaciones. Por tanto, la ejecucion guiada actua como una de las fuentes principales de evidencia experimental del proyecto.
