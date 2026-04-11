# Interfaces de operacion CLI y MCP

## Descripcion de la solucion

Se han desarrollado dos interfaces de operacion para interactuar con el benchmark: una Command Line Interface (CLI), o interfaz de linea de comandos, y una interfaz basada en Model Context Protocol (MCP), o protocolo de contexto para modelos. Ambas interfaces se apoyan en el mismo nucleo funcional, por lo que no duplican la logica principal de ejecucion.

La CLI permite lanzar los modos principales desde terminal mediante comandos como `guided`, `explore`, `heal`, `fullbench` y `report`. La interfaz MCP expone herramientas que pueden ser utilizadas por clientes compatibles para listar objetivos, describir aplicaciones, ejecutar suites, obtener informes o lanzar reparaciones especificas.

## Metodologia aplicada

Se ha aplicado una metodologia de separacion entre interfaz y dominio. El paquete `harness-core` concentra la logica de benchmark, mientras que `harness-cli` y `harness-mcp` actuan como capas de entrada. Esta division permite que el sistema pueda operarse manualmente desde consola o integrarse con herramientas externas sin modificar el nucleo.

La CLI se orienta a flujos reproducibles de ejecucion local. Cada comando acepta argumentos y opciones que permiten seleccionar aplicaciones, modelos, numero de ensayos, paralelismo, limites de pasos y alcance de reconstruccion de informes. La salida final se emite en formato estructurado, lo que facilita su lectura por humanos y tambien su consumo por otras herramientas.

La interfaz MCP se orienta a integracion con agentes y entornos de desarrollo asistidos. Las herramientas definidas exponen contratos de entrada mediante esquemas de validacion. Esta aproximacion reduce ambiguedades y permite que un cliente conozca que parametros requiere cada operacion.

## Herramientas, tecnologias y modelos empleados

La CLI se ha implementado con Commander sobre Node.js y TypeScript. Commander proporciona el registro de comandos, argumentos, opciones y validacion basica de parametros. Los scripts del `package.json` enlazan estos comandos con flujos de uso frecuentes mediante pnpm.

La interfaz MCP se ha implementado con el SDK oficial de Model Context Protocol. Las herramientas utilizan Zod para definir esquemas de entrada. Esta validacion resulta util porque operaciones como ejecutar una suite, reparar un finding o comparar runs requieren parametros concretos y deben rechazar entradas incompletas o mal formadas.

Ambas interfaces utilizan las mismas funciones exportadas por `harness-core`: ejecucion guiada, exploracion, autorreparacion, comparacion, reconstruccion de informes y consulta de objetivos. Por ello, cualquier mejora en el nucleo puede quedar disponible para las dos interfaces sin reescribir los flujos operativos.

## Flujo de datos y artefactos tratados

En el uso por CLI, el usuario invoca un comando desde la raiz del repositorio. La interfaz carga variables de entorno, interpreta los argumentos y llama a la funcion correspondiente del nucleo. Mientras la ejecucion esta activa, pueden emitirse logs de progreso por la salida de error. Al finalizar, se imprime un resumen estructurado con identificadores de run y rutas de artefactos, informes JSON e informes HTML.

En el uso por MCP, un cliente solicita una herramienta concreta, por ejemplo listar targets o ejecutar una suite. La herramienta valida la entrada, llama al nucleo y devuelve la respuesta producida por la operacion. Este flujo permite que el benchmark sea accionable desde un entorno conversacional o desde un agente de desarrollo.

Las operaciones no se limitan a ejecutar nuevos benchmarks. Tambien se puede obtener un informe por identificador de run, comparar ejecuciones previas y reconstruir informes desde datos ya guardados. Esta capacidad facilita trabajar con ejecuciones historicas sin repetir procesos costosos.

## Papel dentro del sistema completo

Las interfaces de operacion convierten la arquitectura interna en una herramienta utilizable. La CLI cubre el uso directo por parte de la persona investigadora o desarrolladora. La interfaz MCP abre la posibilidad de integrar el benchmark con agentes, editores o clientes que necesiten interactuar con el sistema de forma estructurada.

Este modulo se relaciona con todos los demas, pero no decide la metodologia experimental. Su papel consiste en exponer de forma consistente las capacidades del nucleo. Gracias a esta separacion, el sistema puede evolucionar internamente sin obligar a cambiar la forma principal de operarlo.
