# Exploracion autonoma y reutilizacion de acciones

## Descripcion de la solucion

Se ha desarrollado un modulo de exploracion autonoma para estudiar la capacidad de un modelo de inteligencia artificial de descubrir funcionalidades de una aplicacion sin recibir una secuencia cerrada de pasos. A diferencia de la ejecucion guiada, este modo no parte de un flujo exacto, sino de un objetivo general: recorrer la interfaz, identificar estados relevantes y recoger acciones reutilizables.

La exploracion se aplica sobre las mismas aplicaciones benchmark utilizadas en el resto del sistema. Esto permite comparar la exploracion libre con la validacion guiada bajo un contrato funcional comun. El modulo registra los estados visitados, las transiciones realizadas y las acciones observadas, lo que permite construir una representacion del espacio funcional de la interfaz.

## Metodologia aplicada

Se ha aplicado una metodologia de descubrimiento controlado. El prompt autonomo indica al agente que explore la aplicacion, conserve una memoria compacta de los estados visitados, priorice acciones novedosas frente a acciones repetidas y recoja selectores o interacciones utiles para validaciones posteriores.

Para evitar una exploracion indefinida, el benchmark establece limites de pasos, tiempo y numero de ensayos. Tambien define objetivos heuristicos, como un numero minimo de estados, transiciones y tipos de accion. Estos objetivos no representan datos medidos, sino criterios que la suite usara para valorar la cobertura cuando se ejecuten los experimentos.

La exploracion se complementa con escenarios de prueba o probe scenarios. Tras una fase de descubrimiento, el sistema puede reproducir determinados escenarios funcionales para comprobar si la exploracion ha recogido informacion util y si el modelo ha alcanzado zonas relevantes de la aplicacion.

## Herramientas, tecnologias y modelos empleados

El modulo utiliza Stagehand para interactuar con la aplicacion local y OpenRouter para acceder al modelo de inteligencia artificial seleccionado. La logica de exploracion se encuentra en el nucleo TypeScript del proyecto y se apoya en estructuras compartidas para describir acciones observadas, estados, trazas y resumenes.

La representacion de estados se basa en huellas o fingerprints derivados de informacion de la pagina. Se consideran elementos como la URL, hashes del Document Object Model (DOM), o modelo de objetos del documento, y hashes visuales. Esta aproximacion permite distinguir estados de interfaz sin depender exclusivamente del texto visible.

Tambien se ha implementado un grafo de cobertura. En este grafo, los nodos representan estados de la aplicacion y las aristas representan transiciones provocadas por acciones. Esta estructura resulta adecuada para analizar exploracion de interfaces porque permite observar si el agente permanece en un unico estado, repite acciones o alcanza zonas funcionales distintas.

## Flujo de datos y artefactos tratados

Durante la exploracion se generan artefactos especificos. Entre ellos se encuentran el historial de acciones de Stagehand, las paginas o estados descubiertos, el grafo de cobertura, la cache de observaciones, la cache de acciones y un resumen de la exploracion. Tambien pueden registrarse llamadas al modelo, latencia, tokens y costes cuando la configuracion lo permite.

La cache de observaciones almacena informacion asociada a instrucciones y estados concretos. La cache de acciones recoge acciones normalizadas, como selectores, descripciones y metodos de interaccion. Esta informacion se puede utilizar posteriormente para ayudar a una ejecucion guiada o para analizar que partes de la aplicacion han sido descubiertas.

La compatibilidad de una exploracion se evalua mediante datos como la aplicacion objetivo, los fallos activos, el viewport y el modelo. Esta comprobacion evita reutilizar acciones obtenidas bajo condiciones distintas, por ejemplo, con otro bug pack o con otra configuracion visual.

## Papel dentro del sistema completo

La exploracion autonoma cumple una funcion complementaria a la ejecucion guiada. Mientras la ejecucion guiada mide la capacidad de seguir instrucciones conocidas, la exploracion mide la capacidad de descubrir la aplicacion y construir conocimiento operativo sobre ella.

Este modulo se relaciona con el contrato funcional porque sus objetivos de cobertura proceden de las capacidades definidas en el benchmark. Tambien se relaciona con el sistema de informes, que podra sintetizar estados descubiertos, transiciones y diversidad de acciones. Finalmente, se conecta con la ejecucion guiada mediante la posible reutilizacion de observaciones y acciones compatibles.
