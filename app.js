'use strict';
/* =====================================================================
   PIZARRA DE POST-ITS  –  frontend puro + datos guardados en GitHub

   Resumen de cómo funciona:
   - Los datos viven en un archivo JSON (data/datos.json) en la rama "data"
     del repositorio. Se leen y escriben SIEMPRE con la API de GitHub.
   - Dos niveles de guardado:
       1) LOCAL (automático): cada cambio se guarda como BORRADOR en el
          localStorage. No genera commits.
       2) SERVIDOR (manual): solo el botón "Guardar (git)" sube los datos
          y genera un commit. Al subir bien, el borrador se borra.
   ===================================================================== */

// ---------------------------------------------------------------------
// CONSTANTES Y ESTADO
// ---------------------------------------------------------------------
const CLAVE_CONFIG = 'postit_config';     // usuario/repo/rama/ruta/token
const CLAVE_BORRADOR = 'postit_borrador'; // SOLO cambios que todavía no se subieron
const CLAVE_VIEJA = 'postit_local_data';  // clave de una versión anterior (se limpia)

const RAMA_POR_DEFECTO = 'data';
const RUTA_POR_DEFECTO = 'data/datos.json';

const COLORS = ['#fdfd96', '#ffb7b2', '#b5ead7', '#c7ceea', '#e2f0cb'];
const ANCHO_INICIAL = 200, ALTO_INICIAL = 200;
const ANCHO_MIN = 140, ALTO_MIN = 120;

let postits = [];          // datos que se muestran en pantalla
let sha = null;            // "sha" del archivo en el servidor (versión que leímos)
let config = {};           // configuración efectiva (URL + lo guardado + token)
let hayCambios = false;    // true si hay un borrador sin subir
let subiendo = false;
let errorActual = '';      // mensaje de error visible en el indicador
let horaUltimaSubida = ''; // "HH:MM" de la última subida exitosa
let cargando = true;
let guardarPendiente = false; // true si el panel se abrió desde "Guardar (git)"
let zTop = 1;              // para traer un post-it al frente
const elementos = new Map(); // id de post-it -> elemento del DOM

// ---------------------------------------------------------------------
// ELEMENTOS DEL DOM
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const board = $('board');
const btnNew = $('btn-new');
const btnSaveGit = $('btn-save-git');
const btnConfig = $('btn-config');
const statusBox = $('status');
const statusText = $('status-text');
const readBanner = $('read-banner');

const configModal = $('config-modal');
const inputUser = $('conf-user');
const inputRepo = $('conf-repo');
const inputBranch = $('conf-branch');
const inputPath = $('conf-path');
const inputToken = $('conf-token');
const tokenState = $('token-state');
const autoHint = $('auto-hint');
const configMsg = $('config-msg');
const configError = $('config-error');

// =====================================================================
// 1) CONFIGURACIÓN
// =====================================================================

/**
 * Deduce usuario y repositorio desde la URL de GitHub Pages:
 *   https://USUARIO.github.io/REPOSITORIO/  ->  {user: USUARIO, repo: REPOSITORIO}
 * Si la página no está en github.io (por ejemplo, probando en local), devuelve {}.
 */
function deducirDeUrl() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return {};
    const user = m[1];
    const primerSegmento = location.pathname.split('/').filter(Boolean)[0];
    // Si no hay segmento, es un sitio de usuario: el repo se llama USUARIO.github.io
    const repo = primerSegmento || location.hostname;
    return { user, repo };
}

/** Lee lo guardado en localStorage (puede incluir el token). */
function leerConfigGuardada() {
    try {
        return JSON.parse(localStorage.getItem(CLAVE_CONFIG)) || {};
    } catch (e) {
        return {};
    }
}

/**
 * Arma la configuración efectiva. Prioridad:
 *   valores guardados por la persona  >  deducidos de la URL  >  por defecto.
 * Así usuario y repositorio funcionan solos, pero se pueden cambiar en el panel.
 */
function cargarConfig() {
    const guardada = leerConfigGuardada();
    const url = deducirDeUrl();
    config = {
        user: guardada.user || url.user || '',
        repo: guardada.repo || url.repo || '',
        branch: guardada.branch || RAMA_POR_DEFECTO,
        path: guardada.path || RUTA_POR_DEFECTO,
        token: guardada.token || ''
    };
}

/**
 * Guarda en localStorage solo lo que se aparta de lo automático
 * (para que, si el sitio cambia de dirección, se siga deduciendo de la URL).
 */
function guardarConfig() {
    const url = deducirDeUrl();
    const aGuardar = {};
    if (config.user && config.user !== url.user) aGuardar.user = config.user;
    if (config.repo && config.repo !== url.repo) aGuardar.repo = config.repo;
    if (config.branch !== RAMA_POR_DEFECTO) aGuardar.branch = config.branch;
    if (config.path !== RUTA_POR_DEFECTO) aGuardar.path = config.path;
    if (config.token) aGuardar.token = config.token;
    localStorage.setItem(CLAVE_CONFIG, JSON.stringify(aGuardar));
}

const hayUsuarioYRepo = () => Boolean(config.user && config.repo);

/**
 * Abre el panel de configuración. Solo se abre:
 *  - al tocar "Guardar (git)" sin token (o sin usuario/repo), o
 *  - cuando la persona toca el engranaje.
 * El token NUNCA se muestra: el campo siempre arranca vacío.
 */
function abrirConfig(mensaje) {
    const url = deducirDeUrl();
    inputUser.value = config.user;
    inputRepo.value = config.repo;
    inputBranch.value = config.branch;
    inputPath.value = config.path;
    inputToken.value = '';
    tokenState.textContent = config.token
        ? 'Hay un token cargado en este equipo (no se muestra por seguridad). Escribí uno nuevo solo si querés reemplazarlo.'
        : 'Todavía no hay token cargado.';
    autoHint.textContent = url.user
        ? 'Detectados automáticamente desde la dirección de la página.'
        : 'No se pudieron deducir de la URL: completalos a mano.';
    // Si falta usuario/repo, mostramos las opciones avanzadas abiertas
    $('advanced').open = !hayUsuarioYRepo();
    configMsg.textContent = mensaje || 'Acá podés cambiar la conexión con GitHub y cargar tu token.';
    configError.textContent = '';
    configModal.classList.remove('hidden');
    // Foco en el token (lo único que normalmente hace falta)
    (hayUsuarioYRepo() ? inputToken : inputUser).focus();
}

function cerrarConfig() {
    configModal.classList.add('hidden');
    guardarPendiente = false;
}

$('btn-cancel-config').addEventListener('click', cerrarConfig);
configModal.addEventListener('mousedown', (e) => { if (e.target === configModal) cerrarConfig(); });
btnConfig.addEventListener('click', () => abrirConfig());

$('btn-save-config').addEventListener('click', async () => {
    const antes = `${config.user}|${config.repo}|${config.branch}|${config.path}`;
    const nuevoToken = inputToken.value.trim();

    config.user = inputUser.value.trim();
    config.repo = inputRepo.value.trim();
    config.branch = inputBranch.value.trim() || RAMA_POR_DEFECTO;
    config.path = inputPath.value.trim() || RUTA_POR_DEFECTO;
    if (nuevoToken) config.token = nuevoToken; // solo reemplaza si escribió algo

    if (!hayUsuarioYRepo()) {
        configError.textContent = 'Completá usuario y repositorio.';
        return;
    }
    guardarConfig();
    inputToken.value = '';

    const despues = `${config.user}|${config.repo}|${config.branch}|${config.path}`;
    const veniaDeGuardar = guardarPendiente;
    cerrarConfig();
    actualizarEstado();

    // Si cambió el destino, se vuelve a leer del servidor
    if (antes !== despues) await iniciar();
    // Si la persona había tocado "Guardar (git)", seguimos con la subida
    if (veniaDeGuardar && config.token) guardarEnGit();
});

/** "Olvidar token": borra SOLO el token. No toca los datos ni el borrador. */
$('btn-forget').addEventListener('click', () => {
    config.token = '';
    guardarConfig();
    tokenState.textContent = 'Token borrado de este equipo.';
    actualizarEstado();
});

// =====================================================================
// 2) COMUNICACIÓN CON GITHUB
// =====================================================================

/**
 * Base64 con soporte de tildes y ñ.
 * btoa/atob solo entienden Latin-1, por eso pasamos por UTF-8 con
 * TextEncoder / TextDecoder.
 */
function utf8ABase64(texto) {
    const bytes = new TextEncoder().encode(texto);
    let binario = '';
    // Se arma de a trozos para no pasarse del límite de argumentos en archivos grandes
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binario);
}

function base64AUtf8(b64) {
    const binario = atob(b64); // GitHub devuelve el base64 con saltos de línea; atob los ignora
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

/** URL de la API de contenidos de GitHub para el archivo de datos. */
function urlContenido(conRama) {
    const ruta = config.path.split('/').map(encodeURIComponent).join('/');
    const base = `https://api.github.com/repos/${encodeURIComponent(config.user)}/${encodeURIComponent(config.repo)}/contents/${ruta}`;
    return conRama ? `${base}?ref=${encodeURIComponent(config.branch)}` : base;
}

/**
 * Encabezados de cada llamada. LEER no necesita token (el repo es público);
 * si hay token, igual se envía en TODAS las llamadas (además sube el límite de lecturas).
 * El token nunca se imprime en la consola.
 */
function encabezados() {
    const h = { Accept: 'application/vnd.github+json' };
    if (config.token) h.Authorization = `Bearer ${config.token}`;
    return h;
}

class ErrorGit extends Error {
    constructor(status, mensaje) { super(mensaje); this.status = status; }
}

/** Traduce el código HTTP a un mensaje claro para la persona. */
function mensajeDeError(status, escritura) {
    switch (status) {
        case 401: return 'Token inválido o vencido (401). Cargá un token nuevo en ⚙️.';
        case 403:
            if (escritura) return 'Sin permiso de escritura (403). Revisá que el token tenga "Contents: Read and write" para este repositorio.';
            return config.token
                ? 'Sin permiso de lectura (403). Revisá el token.'
                : 'Se alcanzó el límite de lecturas sin token (403). Esperá un rato o cargá tu token.';
        case 404: return 'No se encontró el repositorio, la rama o el archivo (404). Revisá la configuración en ⚙️.';
        case 409:
        case 422: return 'El archivo cambió en el servidor (409). No se pisó nada: tus cambios siguen guardados en este equipo.';
        default: return `Error ${status} al hablar con GitHub.`;
    }
}

/** Convierte cualquier falla de fetch (por ejemplo, sin internet) en un mensaje claro. */
function textoDeFalla(err, escritura) {
    if (err instanceof ErrorGit) return err.message;
    if (err instanceof TypeError) return 'Sin conexión. Revisá tu internet e intentá de nuevo.';
    return `${escritura ? 'Error al subir' : 'Error de lectura'}: ${err.message}`;
}

/**
 * LECTURA: pide el archivo a la API (no a la URL de Pages, que puede estar
 * desactualizada). Guarda el "sha" de esta versión: GitHub lo exige al escribir
 * para saber sobre qué versión estamos editando.
 * Devuelve la lista de post-its del servidor.
 */
async function leerDeGit() {
    const resp = await fetch(urlContenido(true), { headers: encabezados(), cache: 'no-store' });

    if (resp.status === 404) {
        // Puede ser que el archivo todavía no exista: se creará en la primera subida
        sha = null;
        throw new ErrorGit(404, 'No se encontró el archivo en el servidor (404). Si es la primera vez, se creará al guardar; si no, revisá ⚙️.');
    }
    if (!resp.ok) throw new ErrorGit(resp.status, mensajeDeError(resp.status, false));

    const data = await resp.json();
    sha = data.sha;
    const lista = JSON.parse(base64AUtf8(data.content));
    return Array.isArray(lista) ? lista : [];
}

// =====================================================================
// 3) DOS NIVELES DE GUARDADO
// =====================================================================

/** NIVEL 1 – local: guarda el borrador. Solo contiene cambios aún no subidos. */
function guardarBorrador() {
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({
        guardado: new Date().toISOString(),
        postits
    }));
    hayCambios = true;
    errorActual = '';
    horaUltimaSubida = '';
    actualizarEstado();
}

function leerBorrador() {
    try {
        const b = JSON.parse(localStorage.getItem(CLAVE_BORRADOR));
        return b && Array.isArray(b.postits) ? b : null;
    } catch (e) {
        return null;
    }
}

function borrarBorrador() {
    localStorage.removeItem(CLAVE_BORRADOR);
    hayCambios = false;
}

const dosDigitos = (n) => String(n).padStart(2, '0');
const horaActual = () => { const d = new Date(); return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`; };

/** Mensaje de commit automático: "Actualización de datos – AAAA-MM-DD HH:MM" */
function mensajeDeCommit() {
    const d = new Date();
    return `Actualización de datos – ${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())} ${horaActual()}`;
}

/**
 * NIVEL 2 – servidor: ÚNICA función que genera commits.
 * Solo se llama desde el botón "Guardar (git)".
 */
async function guardarEnGit() {
    if (subiendo) return;

    // Sin token (o sin usuario/repo) no se puede escribir: se abre el panel
    if (!config.token || !hayUsuarioYRepo()) {
        guardarPendiente = true;
        abrirConfig(config.token
            ? 'Faltan datos de conexión (usuario o repositorio).'
            : 'Para subir tus post-its a GitHub necesitás cargar tu token.');
        return;
    }
    if (!hayCambios) {
        errorActual = '';
        statusText.textContent = 'No hay cambios para subir';
        return;
    }

    subiendo = true;
    errorActual = '';
    actualizarEstado();

    try {
        const cuerpo = {
            message: mensajeDeCommit(),
            content: utf8ABase64(JSON.stringify(postits, null, 2)),
            branch: config.branch
        };
        // El sha de la última lectura le dice a GitHub qué versión estamos modificando.
        // Si alguien más cambió el archivo entre medio, GitHub responde 409 y no pisa nada.
        // Sin sha (archivo inexistente) se crea el archivo nuevo.
        if (sha) cuerpo.sha = sha;

        const resp = await fetch(urlContenido(false), {
            method: 'PUT',
            headers: { ...encabezados(), 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
            cache: 'no-store'
        });

        if (!resp.ok) throw new ErrorGit(resp.status, mensajeDeError(resp.status, true));

        const data = await resp.json();
        sha = data.content.sha; // el nuevo sha, necesario para la próxima subida

        // Subida exitosa: ya no hay nada pendiente, se borra el borrador
        borrarBorrador();
        horaUltimaSubida = horaActual();
    } catch (err) {
        // Ante cualquier error el borrador se conserva (no lo tocamos)
        errorActual = textoDeFalla(err, true);
        if (err instanceof ErrorGit && (err.status === 409 || err.status === 422)) {
            subiendo = false;
            actualizarEstado();
            await ofrecerRecarga();
            return;
        }
    }
    subiendo = false;
    actualizarEstado();
}

/** Conflicto 409: no se pisa nada; se ofrece recargar lo del servidor. */
async function ofrecerRecarga() {
    const eleccion = await preguntar({
        titulo: 'El archivo cambió en el servidor',
        mensaje: 'Alguien más (u otro equipo) subió cambios después de que abriste la página. No se pisó nada. ' +
                 'Si recargás, se descartan los cambios de este equipo y se muestra lo del servidor.',
        botones: [
            { texto: 'Seguir editando', valor: false, clase: 'btn-secondary' },
            { texto: 'Recargar del servidor', valor: true, clase: 'btn-danger' }
        ]
    });
    if (eleccion) {
        borrarBorrador();
        errorActual = '';
        await iniciar();
    }
}

btnSaveGit.addEventListener('click', guardarEnGit);

// Avisar al cerrar la pestaña si hay un borrador sin subir
window.addEventListener('beforeunload', (e) => {
    if (hayCambios) {
        e.preventDefault();
        e.returnValue = 'Tenés cambios sin subir a GitHub.';
    }
});

// =====================================================================
// 4) INICIO
// =====================================================================

/**
 * Al abrir la página:
 *  1. Lee los datos del servidor (con o sin token).
 *  2. Si existe un borrador => hay cambios sin subir: pregunta si se recuperan o se descartan.
 *     Si no existe => muestra los datos del servidor sin preguntar nada.
 * Los datos leídos del servidor NUNCA se copian al localStorage.
 */
async function iniciar() {
    cargando = true;
    errorActual = '';
    actualizarEstado();

    let datosServidor = [];
    let fallaLectura = '';

    if (hayUsuarioYRepo()) {
        try {
            datosServidor = await leerDeGit();
        } catch (err) {
            fallaLectura = textoDeFalla(err, false);
        }
    } else {
        fallaLectura = 'No se pudo deducir usuario y repositorio de la URL. Completalos en ⚙️.';
    }

    const borrador = leerBorrador();
    if (borrador) {
        // Si no pudimos leer el servidor, usamos el borrador sin molestar con la pregunta
        const recuperar = fallaLectura ? true : await preguntar({
            titulo: 'Hay cambios sin subir',
            mensaje: `Encontramos cambios de este equipo que todavía no se subieron a GitHub (guardados el ${new Date(borrador.guardado).toLocaleString('es-AR')}). ¿Querés recuperarlos o descartarlos?`,
            botones: [
                { texto: 'Descartar', valor: false, clase: 'btn-danger' },
                { texto: 'Recuperar cambios', valor: true, clase: 'btn-primary' }
            ]
        });
        if (recuperar) {
            postits = borrador.postits;
            hayCambios = true;
        } else {
            borrarBorrador();
            postits = datosServidor;
        }
    } else {
        hayCambios = false;
        postits = datosServidor;
    }

    errorActual = fallaLectura;
    cargando = false;
    renderBoard();
    actualizarEstado();
}

// =====================================================================
// 5) INDICADOR DE ESTADO
// =====================================================================

/** Decide qué mostrar según el estado actual (un solo lugar, sin contradicciones). */
function actualizarEstado() {
    let tipo, texto;
    if (subiendo) { tipo = 'busy'; texto = 'Subiendo…'; }
    else if (errorActual) { tipo = 'error'; texto = errorActual; }
    else if (cargando) { tipo = 'busy'; texto = 'Cargando…'; }
    else if (hayCambios) { tipo = 'warn'; texto = 'Cambios guardados en este equipo'; }
    else if (horaUltimaSubida) { tipo = 'ok'; texto = `Subido a las ${horaUltimaSubida}`; }
    else if (!config.token) { tipo = 'read'; texto = 'Modo lectura'; }
    else { tipo = 'ok'; texto = 'Sin cambios pendientes'; }

    statusBox.dataset.kind = tipo;
    statusText.textContent = texto;

    // "Guardar (git)" se destaca con cambios pendientes y se desactiva mientras sube
    btnSaveGit.disabled = subiendo;
    btnSaveGit.classList.toggle('pendiente', hayCambios && !subiendo);
    readBanner.classList.toggle('hidden', Boolean(config.token));
}

// =====================================================================
// 6) DIÁLOGOS Y AVISOS (reemplazan a confirm/alert)
// =====================================================================

/** Muestra un diálogo y devuelve una promesa con el "valor" del botón elegido. */
function preguntar({ titulo, mensaje, botones }) {
    return new Promise((resolve) => {
        $('dialog-title').textContent = titulo;
        $('dialog-msg').textContent = mensaje;
        const caja = $('dialog-buttons');
        caja.innerHTML = '';
        botones.forEach((b) => {
            const btn = document.createElement('button');
            btn.textContent = b.texto;
            btn.className = b.clase || 'btn-secondary';
            btn.addEventListener('click', () => {
                $('dialog-modal').classList.add('hidden');
                resolve(b.valor);
            });
            caja.appendChild(btn);
        });
        $('dialog-modal').classList.remove('hidden');
        caja.lastElementChild.focus();
    });
}

let temporizadorAviso = null;
/** Aviso flotante con botón de acción (usado para "Deshacer" al borrar). */
function mostrarAviso(texto, textoAccion, accion) {
    clearTimeout(temporizadorAviso);
    $('toast-text').textContent = texto;
    const btn = $('toast-action');
    btn.textContent = textoAccion;
    btn.onclick = () => { ocultarAviso(); accion(); };
    $('toast').classList.remove('hidden');
    temporizadorAviso = setTimeout(ocultarAviso, 6000);
}
function ocultarAviso() { $('toast').classList.add('hidden'); }

// =====================================================================
// 7) POST-ITS (crear, editar, mover, cambiar tamaño, color, borrar)
// =====================================================================

btnNew.addEventListener('click', () => {
    const ancho = ANCHO_INICIAL, alto = ALTO_INICIAL;
    // Aparece cerca del centro de la zona visible, con un pequeño desfase para no tapar el anterior
    const desfase = (postits.length % 6) * 18;
    const nuevo = {
        id: Date.now(),
        texto: '',
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        fecha: new Date().toLocaleDateString('es-AR'),
        x: Math.max(10, board.scrollLeft + (board.clientWidth - ancho) / 2 + desfase - 54),
        y: Math.max(10, board.scrollTop + (board.clientHeight - alto) / 2 + desfase - 54),
        w: ancho,
        h: alto,
        rotation: Math.round(((Math.random() * 6) - 3) * 10) / 10 // giro leve de -3 a 3 grados
    };
    postits.push(nuevo);
    guardarBorrador();
    renderBoard();
    iniciarEdicion(nuevo.id); // se abre directo para escribir
});

/** Dibuja todo el tablero desde cero (se usa al cargar, crear y borrar). */
function renderBoard() {
    board.innerHTML = '';
    elementos.clear();
    postits.forEach(crearElemento);
}

function crearElemento(p) {
    const el = document.createElement('div');
    el.className = 'postit';
    el.dataset.id = p.id;
    el.style.backgroundColor = p.color || COLORS[0];
    el.style.left = `${p.x || 0}px`;
    el.style.top = `${p.y || 0}px`;
    el.style.width = `${p.w || ANCHO_INICIAL}px`;
    el.style.height = `${p.h || ALTO_INICIAL}px`;
    el.style.transform = `rotate(${p.rotation || 0}deg)`;
    el.style.zIndex = ++zTop;

    // Texto
    const textDiv = document.createElement('div');
    textDiv.className = 'postit-text';
    textDiv.textContent = p.texto;
    textDiv.title = 'Doble clic para editar';
    textDiv.addEventListener('dblclick', (e) => { e.stopPropagation(); iniciarEdicion(p.id); });

    // Pie: fecha + paleta de colores
    const footer = document.createElement('div');
    footer.className = 'postit-footer';
    const fecha = document.createElement('span');
    fecha.textContent = p.fecha || '';
    const paleta = document.createElement('div');
    paleta.className = 'color-palette';
    COLORS.forEach((c) => {
        const dot = document.createElement('button');
        dot.className = 'color-dot' + (c === p.color ? ' activo' : '');
        dot.style.backgroundColor = c;
        dot.title = 'Cambiar color';
        dot.setAttribute('aria-label', 'Cambiar color');
        dot.addEventListener('click', () => {
            p.color = c;
            el.style.backgroundColor = c;
            paleta.querySelectorAll('.color-dot').forEach((d) => d.classList.toggle('activo', d === dot));
            guardarBorrador();
        });
        paleta.appendChild(dot);
    });
    footer.append(fecha, paleta);

    // Botón borrar (con "Deshacer", sin ventanas molestas)
    const btnDel = document.createElement('button');
    btnDel.className = 'btn-delete';
    btnDel.textContent = '✕';
    btnDel.title = 'Borrar post-it';
    btnDel.setAttribute('aria-label', 'Borrar post-it');
    btnDel.addEventListener('click', () => borrarPostit(p.id));

    // Tirador de tamaño
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.title = 'Arrastrá para cambiar el tamaño';
    activarCambioDeTamano(handle, el, p);

    el.append(btnDel, textDiv, footer, handle);
    activarArrastre(el, p);
    board.appendChild(el);
    elementos.set(p.id, { el, textDiv });
}

function borrarPostit(id) {
    const indice = postits.findIndex((x) => x.id === id);
    if (indice < 0) return;
    const [borrado] = postits.splice(indice, 1);
    guardarBorrador();
    renderBoard();
    mostrarAviso('Post-it borrado', 'Deshacer', () => {
        postits.splice(Math.min(indice, postits.length), 0, borrado);
        guardarBorrador();
        renderBoard();
    });
}

/** Edición de texto: doble clic. Enter+Ctrl o clic afuera guarda; Esc cancela. */
function iniciarEdicion(id) {
    const ref = elementos.get(id);
    const p = postits.find((x) => x.id === id);
    if (!ref || !p || ref.el.querySelector('textarea')) return;

    const area = document.createElement('textarea');
    area.className = 'postit-textarea';
    area.value = p.texto;
    area.placeholder = 'Escribí tu nota…';
    ref.el.replaceChild(area, ref.textDiv);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);

    let cancelado = false;
    area.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { cancelado = true; area.blur(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) area.blur();
    });
    area.addEventListener('blur', () => {
        if (!cancelado && area.value !== p.texto) {
            p.texto = area.value;
            guardarBorrador();
        }
        ref.textDiv.textContent = p.texto;
        if (area.parentNode === ref.el) ref.el.replaceChild(ref.textDiv, area);
    });
}

/** Lleva el post-it al final de la lista (queda arriba de los demás, también al recargar). */
function traerAlFrente(p, el) {
    el.style.zIndex = ++zTop;
    const i = postits.indexOf(p);
    if (i >= 0 && i !== postits.length - 1) {
        postits.splice(i, 1);
        postits.push(p);
        return true;
    }
    return false;
}

/** Arrastrar con mouse, lápiz o dedo (Pointer Events). */
function activarArrastre(el, p) {
    el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // No arrastrar si se toca el textarea, un botón o el tirador de tamaño
        if (e.target.closest('textarea, button, .resize-handle')) return;

        const inicio = { x: e.clientX, y: e.clientY, px: p.x || 0, py: p.y || 0 };
        let movio = false;
        el.setPointerCapture(e.pointerId);
        el.classList.add('moviendo');
        el.style.zIndex = ++zTop;

        const mover = (ev) => {
            const dx = ev.clientX - inicio.x, dy = ev.clientY - inicio.y;
            if (!movio && Math.hypot(dx, dy) < 3) return; // pequeño margen para no confundir con un clic
            movio = true;
            p.x = Math.max(0, Math.round(inicio.px + dx));
            p.y = Math.max(0, Math.round(inicio.py + dy));
            el.style.left = `${p.x}px`;
            el.style.top = `${p.y}px`;
        };
        const soltar = () => {
            el.removeEventListener('pointermove', mover);
            el.removeEventListener('pointerup', soltar);
            el.removeEventListener('pointercancel', soltar);
            el.classList.remove('moviendo');
            if (movio) {
                traerAlFrente(p, el);
                guardarBorrador();
            }
        };
        el.addEventListener('pointermove', mover);
        el.addEventListener('pointerup', soltar);
        el.addEventListener('pointercancel', soltar);
    });
}

/**
 * Cambiar el tamaño arrastrando la esquina inferior derecha.
 * Como el post-it puede estar levemente girado, el movimiento del mouse se
 * "des-gira" para medir cuánto crece el ancho y el alto del papel.
 */
function activarCambioDeTamano(handle, el, p) {
    handle.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation(); // que no se interprete como arrastre del post-it
        e.preventDefault();

        const ang = ((p.rotation || 0) * Math.PI) / 180;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const inicio = { x: e.clientX, y: e.clientY, w: p.w || ANCHO_INICIAL, h: p.h || ALTO_INICIAL };
        let cambio = false;
        handle.setPointerCapture(e.pointerId);
        el.style.zIndex = ++zTop;

        const mover = (ev) => {
            const dx = ev.clientX - inicio.x, dy = ev.clientY - inicio.y;
            const dxLocal = dx * cos + dy * sin;
            const dyLocal = -dx * sin + dy * cos;
            p.w = Math.max(ANCHO_MIN, Math.round(inicio.w + dxLocal));
            p.h = Math.max(ALTO_MIN, Math.round(inicio.h + dyLocal));
            el.style.width = `${p.w}px`;
            el.style.height = `${p.h}px`;
            cambio = true;
        };
        const soltar = () => {
            handle.removeEventListener('pointermove', mover);
            handle.removeEventListener('pointerup', soltar);
            handle.removeEventListener('pointercancel', soltar);
            if (cambio) {
                traerAlFrente(p, el);
                guardarBorrador();
            }
        };
        handle.addEventListener('pointermove', mover);
        handle.addEventListener('pointerup', soltar);
        handle.addEventListener('pointercancel', soltar);
    });
}

// =====================================================================
// ARRANQUE
// =====================================================================
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !configModal.classList.contains('hidden')) cerrarConfig();
});

document.addEventListener('DOMContentLoaded', () => {
    localStorage.removeItem(CLAVE_VIEJA); // limpieza: la versión anterior copiaba acá los datos del servidor
    cargarConfig();
    actualizarEstado();
    // OJO: el panel NO se abre solo al iniciar. Solo se abre al tocar "Guardar (git)" sin token.
    iniciar();
});
