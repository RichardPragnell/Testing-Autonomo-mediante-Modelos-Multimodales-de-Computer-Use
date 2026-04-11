# Contrato funcional y aplicaciones benchmark reproducibles

## Descripcion de la solucion

Se ha desarrollado un conjunto de aplicaciones benchmark orientadas a evaluar agentes de Quality Assurance (QA) sobre una superficie funcional controlada. La solucion toma como referencia una aplicacion de gestion de tareas de tipo Todo, implementada en React, Next.js y Angular. Las tres variantes comparten el mismo comportamiento visible, los mismos datos iniciales y los mismos flujos funcionales, aunque cada una utiliza su propio framework y su propia estructura interna.

El elemento central de este modulo es el contrato funcional definido en `specs/todo-web/contract.json`. Este contrato actua como fuente de verdad independiente del framework. En el se describen la interfaz esperada, los textos visibles, los datos semilla, los identificadores de escenarios, las acciones principales y los fallos controlados que pueden inyectarse durante la evaluacion. De este modo, la comparacion entre ejecuciones no depende de interpretaciones distintas de la aplicacion, sino de un comportamiento comun previamente fijado.

La aplicacion se ha mantenido deliberadamente pequena. Esta decision permite aislar el objeto de estudio: la capacidad de los modelos de inteligencia artificial para explorar, ejecutar pruebas, diagnosticar fallos y proponer reparaciones. Se evita que la complejidad propia de una aplicacion empresarial o de un backend externo introduzca ruido en el analisis metodologico.

## Metodologia aplicada

Se ha definido un entorno reproducible como base metodologica del proyecto. Cada implementacion de la aplicacion Todo se conserva como una plantilla limpia, y las ejecuciones del benchmark se realizan sobre copias preparadas especificamente para cada run. Esta estrategia evita que una prueba modifique el estado de otra y permite repetir los experimentos bajo condiciones equivalentes.

La reproducibilidad se apoya en varios criterios. En primer lugar, el estado de la aplicacion es local y en memoria, por lo que cada recarga devuelve los mismos datos iniciales. En segundo lugar, los escenarios funcionales tienen identificadores estables y pasos definidos de forma explicita. En tercer lugar, los paquetes de fallos reproducen defectos equivalentes en cada framework, aunque el archivo tecnico afectado pueda variar. Por ultimo, los manifiestos de cada aplicacion describen el comando de arranque, la URL local, el directorio de plantilla, el directorio de fallos y el comando de validacion.

Esta metodologia permite comparar ejecuciones sin introducir diferencias por el framework utilizado. Si un modelo interactua con React, Next.js o Angular, se enfrenta al mismo contrato funcional. Por tanto, las variaciones observadas en una ejecucion futura podran atribuirse con mayor claridad al comportamiento del modelo, al modo de ejecucion o al tipo de fallo, y no a diferencias no controladas entre aplicaciones.

## Herramientas, tecnologias y modelos empleados

Se han utilizado tres frameworks web actuales: React, Next.js y Angular. Estas implementaciones permiten comprobar que el benchmark no esta ligado a una tecnologia concreta de interfaz. Las aplicaciones se ejecutan localmente y se validan mediante pruebas automatizadas adaptadas a cada plantilla.

El proyecto se gestiona como un monorepo con pnpm y TypeScript. La configuracion de cada aplicacion se define mediante archivos `target.json` y `benchmark.json`. El primero describe como se levanta la Application Under Test (AUT), es decir, la aplicacion sometida a prueba. El segundo vincula la aplicacion con el contrato funcional, los escenarios guiados, los objetivos de exploracion y los casos de autorreparacion.

Los modelos de inteligencia artificial se configuran mediante un registro centralizado en `experiments/models/registry.yaml`. Esta separacion es relevante porque el campo de la inteligencia artificial evoluciona con rapidez. Al no fijar la solucion a un unico modelo, se facilita la incorporacion de nuevas alternativas conforme aparezcan proveedores, versiones o capacidades mas avanzadas. El benchmark puede repetirse con nuevos Large Language Models (LLM), o modelos de lenguaje de gran escala, manteniendo constantes las condiciones funcionales de la prueba.

## Flujo de datos y artefactos tratados

El flujo parte del contrato funcional comun. A partir de el, cada aplicacion declara que escenarios y capacidades soporta. Los escenarios incluyen operaciones como cargar la pantalla inicial, anadir tareas, completar tareas, filtrar elementos activos, editar textos y eliminar tareas temporales. Tambien se definen datos semilla, como las tareas iniciales, para que la aplicacion arranque siempre en un estado conocido.

Los paquetes de fallos introducen defectos controlados, por ejemplo, la perdida de la etiqueta de una tarea creada, la ausencia de cambio de estado al completar una tarea o la falta de persistencia al editar una tarea. Estos fallos no se documentan como resultados, sino como parte del diseno experimental. Su funcion es permitir que el sistema evalue, cuando se ejecute la suite completa, la capacidad de deteccion, diagnostico y reparacion de los modelos.

## Papel dentro del sistema completo

Este modulo proporciona la base comun sobre la que se apoyan el resto de subsistemas. La ejecucion guiada necesita escenarios estables. La exploracion autonoma necesita una interfaz con comportamientos observables. La autorreparacion necesita fallos reproducibles. El analisis posterior necesita que las ejecuciones sean comparables.

Por ello, el contrato funcional y las aplicaciones benchmark constituyen el punto de partida de la solucion. Se ha priorizado que el entorno sea repetible, extensible y suficientemente representativo para estudiar agentes de QA sin depender de una aplicacion externa no controlada.
