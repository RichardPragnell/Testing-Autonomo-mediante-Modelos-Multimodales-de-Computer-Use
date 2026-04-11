# Diagnostico y autorreparacion de fallos

## Descripcion de la solucion

Se ha desarrollado un modulo de diagnostico y autorreparacion para evaluar si un modelo de inteligencia artificial puede identificar la causa probable de un fallo funcional y proponer una correccion limitada. Este modulo trabaja sobre defectos controlados, introducidos mediante bug packs equivalentes en las distintas aplicaciones benchmark.

La autorreparacion no se plantea como una sustitucion completa del trabajo de desarrollo, sino como un experimento acotado de self-healing. El sistema proporciona al modelo informacion contextual sobre el fallo, los escenarios afectados, los archivos candidatos y el comando de validacion. A partir de esa informacion, el modelo debe devolver un diagnostico y un parche en formato diff unificado.

## Metodologia aplicada

Se ha seguido una metodologia de reparacion basada en reproduccion, localizacion y validacion. En primer lugar, un fallo debe estar asociado a uno o varios escenarios de reproduccion. En segundo lugar, el sistema genera candidatos de codigo fuente que pueden explicar el comportamiento observado. En tercer lugar, el modelo de reparacion recibe un contexto estructurado y propone una modificacion minima. Por ultimo, el parche se aplica en un espacio aislado y se ejecuta la validacion correspondiente.

Los bug packs se han disenado para romper una capacidad concreta sin inutilizar la aplicacion completa. Por ejemplo, un fallo puede afectar solo a la persistencia del texto de una tarea creada, al cambio de estado de completado o al guardado de una edicion. Esta acotacion permite que el benchmark valore la reparacion de una conducta especifica y que tambien pueda comprobar que no se introducen regresiones en otros flujos.

El prompt de reparacion solicita una respuesta estructurada con diagnostico, lista breve de archivos sospechosos y el parche minimo. Esta restriccion facilita que el sistema pueda procesar automaticamente la respuesta y evita que la salida del modelo sea solo una explicacion textual no ejecutable.

## Herramientas, tecnologias y modelos empleados

El modulo esta implementado en TypeScript dentro de `packages/harness-core/src/self-heal` y se integra con el resto del nucleo mediante el servicio principal. La ejecucion del agente de reparacion puede realizarse con un cliente basado en OpenRouter o con un cliente simulado para pruebas unitarias.

El formato de parche utilizado es el diff unificado. Este formato permite describir cambios concretos sobre archivos de texto y aplicarlos mediante herramientas estandar. La solucion incluye funciones para extraer bloques de diff desde la respuesta del agente y para aplicar el parche en un worktree aislado.

La validacion se realiza mediante los comandos definidos en los manifiestos de las aplicaciones. En las plantillas Todo, estos comandos ejecutan pruebas automatizadas adaptadas a cada framework. Esta validacion no sustituye a una revision humana, pero proporciona una senal objetiva sobre si el comportamiento esperado se conserva despues de aplicar la reparacion.

## Flujo de datos y evidencias tratadas

El flujo comienza con un finding, es decir, un hallazgo de fallo generado por una ejecucion previa. El finding incluye identificadores de run, modelo, escenario, paso, severidad, categoria, mensaje y posibles artefactos de diagnostico. Tambien puede incluir candidatos de codigo fuente relacionados con el fallo.

Antes de invocar al modelo de reparacion, el sistema recupera fragmentos de archivos candidatos. Estos fragmentos se seleccionan para proporcionar contexto suficiente sin entregar todo el repositorio. La entrada del modelo incluye el fallo, los escenarios relevantes, los archivos candidatos y el comando de validacion.

Si el modelo devuelve un parche, este se guarda como artefacto y se aplica sobre una copia aislada. A continuacion, se ejecuta la validacion. El resultado de esta fase queda registrado con informacion como salida estandar, salida de error, ruta del parche y estado de la reparacion. Esta documentacion no incorpora valores reales de reparaciones, sino que describe el procedimiento preparado para evaluarlas.

## Papel dentro del sistema completo

El modulo de autorreparacion cierra el ciclo experimental. La ejecucion guiada y los bug packs permiten detectar fallos; el diagnostico identifica posibles causas; la reparacion propone cambios; y la validacion comprueba si el comportamiento se recupera sin alterar otros escenarios.

Este modulo se relaciona con el contrato funcional, porque los fallos estan definidos respecto a capacidades concretas. Tambien se relaciona con el modulo de analisis, que podra sintetizar tasas de reparacion, precision de localizacion, aplicacion de parches y regresiones cuando se ejecuten los benchmarks completos.
