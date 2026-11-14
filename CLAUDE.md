@AGENTS.md

## Específico de Claude Code
- Reglas por ruta en `.claude/rules/*.md` (se cargan solas al tocar esos archivos).
- Usa **plan mode** para cambios multi-archivo, migraciones y todo lo de seguridad/RLS.
- Búsquedas amplias → subagente `Explore`; no leas directorios completos.
- Una tarea por sesión; `/clear` entre tareas no relacionadas; `/compact` al ~50 % del contexto.
- Lee `docs/TOKEN-BUDGET.md` si la sesión se alarga o el contexto crece.
- Nunca leas `.env*`, `*.pem`, `secrets/` (bloqueado en `.claude/settings.json`).
- Para APIs de librerías, consulta documentación oficial vigente antes de escribir código.
