<<<<<<< HEAD
// ==========================================
// 0. ESTADO GLOBAL
// ==========================================
let products = [];
let categories = [];
let cart = [];
let boxHistory = [];
let closingHistory = [];
let currentCategory = 'all';
let currentUserRole = '';
let html5QrcodeScanner = null;
let pendingLocalImageData = null; // imagen (base64) subida desde la PC, pendiente de guardar
let currentImgMode = 'local';      // 'local' | 'url'

const STOCK_ALERTA_MINIMO = 5;
const MAX_IMG_WIDTH = 480; // ancho máximo (px) al comprimir imágenes locales antes de guardarlas

// ==========================================
// 1. CONFIGURACIÓN Y CONEXIÓN A SUPABASE
// ==========================================
const SUPABASE_URL = "https://bwigwybxzmmvypwfwuvh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3aWd3eWJ4em1tdnlwd2Z3dXZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDk5NDksImV4cCI6MjA5NzkyNTk0OX0.f5ZFY3G3ysdziQFpiIIbJSUsioMmMFz0VTGoi-Nn8gM";

const supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function') ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ==========================================
// 2. EVENTOS PRINCIPALES Y LOGIN (¡Desvinculado del HTML!)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    console.log("✅ DOM Cargado. Vinculando botón de login...");

    // Capturamos el formulario por su ID
    const formLogin = document.getElementById("form-login");

    if (formLogin) {
        formLogin.addEventListener("submit", function(e) {
            e.preventDefault(); // Evita que la página intente recargarse
            console.log("🔑 Procesando ingreso...");

            const user = document.getElementById("login-user").value.trim().toLowerCase();
            const pass = document.getElementById("login-pass").value;
            const errorDiv = document.getElementById("login-error");

            if ((user === "caja" && pass === "1234") || (user === "admin" && pass === "yosoy")) {
                currentUserRole = user;
                errorDiv.classList.add("hidden");
                document.getElementById("view-login").classList.add("hidden");
                document.getElementById("view-store").classList.remove("hidden");

                const btnAdmin = document.getElementById("btn-to-admin");
                if (user === "admin") {
                    btnAdmin.classList.remove("hidden");
                } else {
                    btnAdmin.classList.add("hidden");
                }
            } else {
                errorDiv.classList.remove("hidden");
            }
        });
    } else {
        console.error("❌ No se encontró el formulario 'form-login' en el HTML.");
    }

    // Estado inicial del selector de imagen (local por defecto)
    setImageMode('local');

    // Iniciar carga de datos a la base
    loadInitialData();
    listenRealtimeChanges();
});

function handleLogout() {
    currentUserRole = '';
    cart = [];
    updateCartUI();
    document.getElementById("view-store").classList.add("hidden");
    document.getElementById("view-admin").classList.add("hidden");
    document.getElementById("view-login").classList.remove("hidden");
    document.getElementById("login-user").value = '';
    document.getElementById("login-pass").value = '';
}

// ==========================================
// 3. MÓDULO DE SINCRONIZACIÓN (SUPABASE)
// ==========================================
async function loadInitialData() {
    if (!supabaseClient) return;
    try {
        const { data: catData, error: catErr } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
        if (catErr) throw catErr;
        categories = [{ id: "all", name: "Todos" }, ...(catData || [])];

        const { data: prodData, error: prodErr } = await supabaseClient.from('products').select('*').order('name', { ascending: true });
        if (prodErr) throw prodErr;
        products = prodData || [];

        const { data: histData, error: histErr } = await supabaseClient.from('box_history').select('*').order('fecha', { ascending: false });
        if (histErr) throw histErr;
        boxHistory = histData || [];

        // La tabla de cierres de caja es nueva: si todavía no la creaste en Supabase, no rompemos la app.
        const { data: cierreData, error: cierreErr } = await supabaseClient.from('cierres_caja').select('*').order('fecha', { ascending: false });
        if (cierreErr) {
            console.warn("No se pudo cargar 'cierres_caja' (¿falta crear la tabla? revisa supabase_setup.sql):", cierreErr.message);
            closingHistory = [];
        } else {
            closingHistory = cierreData || [];
        }

        renderCategoriesUI();
        renderStoreProducts();
        renderInventoryTable();
        renderCategoriesAdminList();
        populateCategorySelect();
        updateAdminDashboard();
        renderAllHistoryTables();
        renderAllClosingTables();
    } catch (error) {
        console.error("Error cargando datos:", error.message);
    }
}

async function refreshCategoriesOnly() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
    if (!error) {
        categories = [{ id: "all", name: "Todos" }, ...(data || [])];
        renderCategoriesUI();
        renderCategoriesAdminList();
        populateCategorySelect();
        renderStoreProducts();
        renderInventoryTable();
    }
}

function listenRealtimeChanges() {
    if (!supabaseClient) return;
    supabaseClient
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
            if (payload.eventType === 'UPDATE') {
                const idx = products.findIndex(p => p.id === payload.new.id);
                if (idx !== -1) products[idx] = payload.new;
            } else if (payload.eventType === 'INSERT') {
                products.push(payload.new);
            } else if (payload.eventType === 'DELETE') {
                products = products.filter(p => p.id !== payload.old.id);
            }
            renderStoreProducts();
            renderInventoryTable();
            updateAdminDashboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
            refreshCategoriesOnly();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'box_history' }, (payload) => {
            boxHistory.unshift(payload.new);
            renderAllHistoryTables();
            updateAdminDashboard();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cierres_caja' }, (payload) => {
            closingHistory.unshift(payload.new);
            renderAllClosingTables();
        })
        .subscribe();
}

function switchView(view) {
    if (view === 'admin' && currentUserRole !== 'admin') {
        alert("Acceso denegado.");
        return;
    }
    if (view === 'admin') {
        document.getElementById("view-store").classList.add("hidden");
        document.getElementById("view-admin").classList.remove("hidden");
        switchAdminTab('dashboard');
    } else {
        document.getElementById("view-admin").classList.add("hidden");
        document.getElementById("view-store").classList.remove("hidden");
    }
}

// ==========================================
// 4. INTERFAZ DEL PUNTO DE VENTA (TIENDA)
// ==========================================
function renderCategoriesUI() {
    const container = document.getElementById("store-categories-bar");
    if (!container) return;
    container.innerHTML = categories.map(cat => `
        <button onclick="filterByCategory('${cat.id}')" 
                class="px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${currentCategory === cat.id ? 'bg-primary text-white shadow-sm' : 'bg-white text-gray-600 hover:bg-gray-100 border'}">
            ${cat.name}
        </button>
    `).join('');
}

function filterByCategory(catId) {
    currentCategory = catId;
    renderCategoriesUI();
    renderStoreProducts();
}

function filterProducts() {
    renderStoreProducts();
}

function renderStoreProducts() {
    const grid = document.getElementById("product-grid");
    const searchVal = document.getElementById("search-input").value.toLowerCase().trim();
    if (!grid) return;

    let filtered = products;

    if (currentCategory !== 'all') {
        filtered = filtered.filter(p => p.category === currentCategory);
    }

    if (searchVal) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchVal) || String(p.code).includes(searchVal));
    }

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-8 text-gray-400 text-xs">No se encontraron herramientas.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(p => {
        const isLowStock = p.stock <= STOCK_ALERTA_MINIMO;
        const isOut = p.stock <= 0;

        return `
            <div class="bg-white rounded-xl shadow-xs border border-gray-100 overflow-hidden flex flex-col justify-between p-3 group relative hover:shadow-md transition">
                ${isLowStock ? `<span class="absolute top-2 left-2 z-10 text-[9px] font-black uppercase tracking-wider ${isOut ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'} px-2 py-0.5 rounded-md">${isOut ? 'Agotado' : 'Stock Bajo'}</span>` : ''}
                <div class="w-full h-28 bg-gray-50 rounded-lg overflow-hidden mb-2 flex items-center justify-center">
                    <img src="${p.img || 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=300&q=80'}" class="object-cover w-full h-full group-hover:scale-105 transition duration-300">
                </div>
                <div>
                    <p class="text-[10px] font-bold text-gray-400 uppercase">${getCategoryName(p.category)}</p>
                    <h4 class="font-bold text-gray-800 text-xs line-clamp-2 mt-0.5 min-h-[32px]">${p.name}</h4>
                    <span class="text-[10px] text-gray-400 font-mono block mt-0.5">Cód: ${p.code}</span>
                </div>
                <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                    <div>
                        <span class="text-[10px] text-gray-400 block leading-tight">Precio</span>
                        <span class="text-xs font-black text-secondary">Bs. ${parseFloat(p.price).toFixed(2)}</span>
                    </div>
                    <button onclick="addToCart(${p.id})" ${isOut ? 'disabled' : ''} 
                            class="bg-secondary text-white text-xs font-bold px-2.5 py-1.5 rounded-lg hover:bg-primary transition disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                        <i class="fas fa-plus text-[10px] mr-1"></i>Añadir
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function getCategoryName(catId) {
    const found = categories.find(c => c.id === catId);
    return found ? found.name : 'Varios';
}

// ==========================================
// 5. CONTROL DEL CARRITO DE COMPRAS
// ==========================================
function toggleCart() {
    document.getElementById("cart-modal").classList.toggle("hidden");
}

function addToCart(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const cartItem = cart.find(item => item.id === id);
    if (cartItem) {
        if (cartItem.qty >= product.stock) {
            alert(`Límite de stock alcanzado: ${product.stock} unidades.`);
            return;
        }
        cartItem.qty++;
    } else {
        if (product.stock <= 0) {
            alert("No hay existencias.");
            return;
        }
        cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
}

function updateCartQty(id, change) {
    const item = cart.find(i => i.id === id);
    const product = products.find(p => p.id === id);
    if (!item || !product) return;

    if (change > 0 && item.qty >= product.stock) {
        alert("Stock máximo alcanzado.");
        return;
    }

    item.qty += change;
    if (item.qty <= 0) {
        cart = cart.filter(i => i.id !== id);
    }
    updateCartUI();
}

function getCartSubtotal() {
    return cart.reduce((a, b) => a + (parseFloat(b.price) * b.qty), 0);
}

function updateCartUI() {
    const countSpan = document.getElementById("cart-count");
    const container = document.getElementById("cart-items");
    const totalSpan = document.getElementById("cart-total");

    if (!countSpan || !container || !totalSpan) return;

    const totalCount = cart.reduce((a, b) => a + b.qty, 0);
    countSpan.innerText = totalCount;

    if (cart.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-gray-300"><p class="text-xs font-bold">La orden está vacía</p></div>`;
        totalSpan.innerText = "Bs. 0.00";
        return;
    }

    container.innerHTML = cart.map(item => `
        <div class="flex items-center justify-between bg-gray-50 p-2 rounded-xl border border-gray-100">
            <div class="flex-1 min-w-0 pr-2">
                <h5 class="font-bold text-xs text-gray-800 truncate">${item.name}</h5>
                <p class="text-[10px] text-gray-400">Bs. ${parseFloat(item.price).toFixed(2)} c/u</p>
            </div>
            <div class="flex items-center space-x-2">
                <div class="flex items-center bg-white border rounded-lg px-1">
                    <button onclick="updateCartQty(${item.id}, -1)" class="text-gray-400 hover:text-red-500 px-1 font-bold">-</button>
                    <span class="px-2 text-xs font-mono font-bold">${item.qty}</span>
                    <button onclick="updateCartQty(${item.id}, 1)" class="text-gray-400 hover:text-green-500 px-1 font-bold">+</button>
                </div>
                <span class="text-xs font-bold text-secondary min-w-[55px] text-right">Bs. ${(item.price * item.qty).toFixed(2)}</span>
            </div>
        </div>
    `).join('');

    totalSpan.innerText = `Bs. ${getCartSubtotal().toFixed(2)}`;
}

function openCustomerModal() {
    if (cart.length === 0) {
        alert("Agregue ítems al carrito.");
        return;
    }
    document.getElementById("discount-input").value = 0;
    updateCheckoutPreview();
    document.getElementById("customer-modal").classList.remove("hidden");
}

function closeCustomerModal() {
    document.getElementById("customer-modal").classList.add("hidden");
}

function updateCheckoutPreview() {
    const subtotal = getCartSubtotal();
    let pct = parseFloat(document.getElementById("discount-input").value) || 0;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    const montoDescuento = subtotal * (pct / 100);
    const total = subtotal - montoDescuento;

    document.getElementById("checkout-subtotal").innerText = `Bs. ${subtotal.toFixed(2)}`;
    document.getElementById("checkout-discount-amount").innerText = `- Bs. ${montoDescuento.toFixed(2)}`;
    document.getElementById("checkout-total-final").innerText = `Bs. ${total.toFixed(2)}`;
}

// ==========================================
// 6. PROCESO DE VENTA Y TICKETS
// ==========================================
async function processOrder(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerText : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = "Procesando..."; }

    try {
        const type = document.querySelector('input[name="doc-type"]:checked').value;
        const name = document.getElementById('cli-name').value.toUpperCase().trim();
        const doc = document.getElementById('cli-doc').value.trim();

        let descuentoPct = parseFloat(document.getElementById('discount-input').value) || 0;
        if (descuentoPct < 0) descuentoPct = 0;
        if (descuentoPct > 100) descuentoPct = 100;

        const subtotal = getCartSubtotal();
        const descuentoMonto = subtotal * (descuentoPct / 100);
        const total = subtotal - descuentoMonto;

        // 1) Releemos el stock REAL desde la base de datos (nunca confiamos solo en la caché local).
        //    Esto evita el bug de "el stock no baja" cuando el valor en pantalla está desactualizado.
        const ids = cart.map(i => i.id);
        const { data: liveProducts, error: liveErr } = await supabaseClient
            .from('products')
            .select('id, stock, name')
            .in('id', ids);
        if (liveErr) throw liveErr;

        // 2) Validamos que haya stock suficiente para TODO el carrito antes de cobrar nada.
        const faltantes = [];
        for (const item of cart) {
            const live = liveProducts.find(p => p.id === item.id);
            const stockReal = live ? Number(live.stock) : 0;
            if (stockReal < item.qty) {
                faltantes.push(`${item.name} (disponible: ${stockReal}, solicitado: ${item.qty})`);
            }
        }
        if (faltantes.length > 0) {
            alert("No se puede completar la venta, stock insuficiente para:\n" + faltantes.join("\n"));
            return;
        }

        // 3) Descontamos el stock producto por producto, verificando que el UPDATE
        //    realmente afectó una fila. Si "updated" llega vacío (sin error), normalmente
        //    significa que falta una política RLS de UPDATE para el rol "anon" en Supabase.
        for (const item of cart) {
            const live = liveProducts.find(p => p.id === item.id);
            const stockReal = Number(live.stock);
            const nuevoStock = Math.max(0, stockReal - item.qty);

            const { data: updated, error: stockErr } = await supabaseClient
                .from('products')
                .update({ stock: nuevoStock })
                .eq('id', item.id)
                .select('id, stock');

            if (stockErr) throw stockErr;
            if (!updated || updated.length === 0) {
                throw new Error(`El stock de "${item.name}" no se pudo actualizar (la base de datos no devolvió cambios). Revisa que la tabla "products" tenga una política RLS de UPDATE habilitada para el rol anon en Supabase — ver supabase_setup.sql.`);
            }
        }

        const transaction = {
            id: "TX-" + Date.now(),
            cliente: name,
            documento: doc,
            tipo: type,
            subtotal: subtotal,
            descuento_pct: descuentoPct,
            descuento_monto: descuentoMonto,
            monto: total,
            detalles: [...cart],
            usuario: currentUserRole
        };

        const { error: txErr } = await supabaseClient.from('box_history').insert([transaction]);
        if (txErr) throw txErr;

        generarHojaImpresion(transaction);

        cart = [];
        updateCartUI();
        closeCustomerModal();
        toggleCart();
        e.target.reset();

        loadInitialData();
    } catch (error) {
        alert("Error crítico: " + error.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = originalBtnText || "Emitir Comprobante"; }
    }
}

function generarHojaImpresion(tx) {
    const ventana = window.open('', '_blank');
    const detalles = tx.detalles || [];
    const subtotal = tx.subtotal !== undefined && tx.subtotal !== null ? parseFloat(tx.subtotal) : detalles.reduce((a, b) => a + (b.price * b.qty), 0);
    const descuentoMonto = tx.descuento_monto !== undefined && tx.descuento_monto !== null ? parseFloat(tx.descuento_monto) : 0;
    const descuentoPct = tx.descuento_pct !== undefined && tx.descuento_pct !== null ? parseFloat(tx.descuento_pct) : 0;
    const total = tx.monto !== undefined && tx.monto !== null ? parseFloat(tx.monto) : subtotal;

    ventana.document.write(`
        <html>
        <head>
            <title>Comprobante ${tx.id}</title>
            <style>
                body { font-family: monospace; width: 72mm; margin: 0 auto; font-size: 11px; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .linea { border-top: 1px dashed #000; margin: 4px 0; }
                table { width: 100%; border-collapse: collapse; }
                .bold { font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <strong>SOL NACIENTE</strong><br>Ferretería - Oruro, Bolivia<br>
                <strong>${tx.tipo.toUpperCase()}</strong><br>Nro: ${tx.id}
            </div>
            <div class="linea"></div>
            <div>FECHA: ${new Date().toLocaleString()}<br>CLIENTE: ${tx.cliente}<br>NIT/CI: ${tx.documento}</div>
            <div class="linea"></div>
            <table>
                ${detalles.map(i => `
                    <tr>
                        <td>${i.qty}x ${String(i.name).substring(0, 18)}</td>
                        <td class="text-right">Bs. ${(i.price * i.qty).toFixed(2)}</td>
                    </tr>
                `).join('')}
            </table>
            <div class="linea"></div>
            <table>
                <tr><td>Subtotal</td><td class="text-right">Bs. ${subtotal.toFixed(2)}</td></tr>
                ${descuentoMonto > 0 ? `<tr><td>Descuento (${descuentoPct}%)</td><td class="text-right">- Bs. ${descuentoMonto.toFixed(2)}</td></tr>` : ''}
            </table>
            <div class="linea"></div>
            <div class="text-right bold">TOTAL: Bs. ${total.toFixed(2)}</div>
            <script>window.print(); window.close();</script>
        </body>
        </html>
    `);
    ventana.document.close();
}

function toggleStoreHistory() {
    const sec = document.getElementById("store-history-section");
    sec.classList.toggle("hidden");
}

function renderHistoryInto(bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;

    if (boxHistory.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-gray-400 text-xs">Sin registros.</td></tr>`;
        return;
    }

    body.innerHTML = boxHistory.map(tx => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-3 font-mono font-bold text-secondary">${tx.id}</td>
            <td class="p-3 text-gray-400">${tx.fecha ? tx.fecha.substring(11, 16) : '--:--'}</td>
            <td class="p-3 uppercase truncate max-w-[120px]">${tx.cliente}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">${tx.tipo}</span></td>
            <td class="p-3 font-bold">Bs. ${parseFloat(tx.monto).toFixed(2)}</td>
            <td class="p-3">
                <button onclick="reimprimirTicket('${tx.id}')" class="bg-gray-100 text-gray-700 p-1 px-2 rounded hover:bg-secondary hover:text-white transition text-[10px]">Copia</button>
            </td>
        </tr>
    `).join('');
}

function renderAllHistoryTables() {
    renderHistoryInto('store-history-table-body');
    renderHistoryInto('admin-history-table-body');
}

function reimprimirTicket(id) {
    const tx = boxHistory.find(t => t.id === id);
    if (tx) generarHojaImpresion(tx);
}

// ==========================================
// 7. CIERRE DE CAJA Y RESPALDOS (BACKUPS)
// ==========================================
function getUltimoCierreFecha() {
    if (closingHistory.length === 0) return null;
    return closingHistory[0].fecha;
}

function getVentasPendientesDeCierre() {
    const ultimaFecha = getUltimoCierreFecha();
    if (!ultimaFecha) return [...boxHistory];
    const corte = new Date(ultimaFecha).getTime();
    return boxHistory.filter(tx => tx.fecha && new Date(tx.fecha).getTime() > corte);
}

async function cerrarCaja() {
    const pendientes = getVentasPendientesDeCierre();
    if (pendientes.length === 0) {
        alert("No hay ventas nuevas desde el último cierre de caja.");
        return;
    }
    if (!confirm(`Se cerrará la caja con ${pendientes.length} venta(s) registradas desde el último cierre. Se generará un respaldo descargable. ¿Continuar?`)) return;

    const totalVentas = pendientes.reduce((a, b) => a + parseFloat(b.monto || 0), 0);
    const totalDescuentos = pendientes.reduce((a, b) => a + parseFloat(b.descuento_monto || 0), 0);

    const cierre = {
        fecha: new Date().toISOString(),
        usuario: currentUserRole || 'desconocido',
        num_transacciones: pendientes.length,
        total_ventas: totalVentas,
        total_descuentos: totalDescuentos,
        snapshot: pendientes
    };

    try {
        if (supabaseClient) {
            const { error } = await supabaseClient.from('cierres_caja').insert([cierre]);
            if (error) throw error;
        }
        descargarBackupJSON(cierre);
        alert("Caja cerrada con éxito. Se descargó el respaldo de la jornada en tu carpeta de descargas.");
        loadInitialData();
    } catch (error) {
        alert("Error al cerrar caja: " + error.message + "\n\n¿Creaste la tabla 'cierres_caja' en Supabase? Revisa el archivo supabase_setup.sql.");
    }
}

function descargarBackupJSON(cierre) {
    const blob = new Blob([JSON.stringify(cierre, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fechaArchivo = new Date(cierre.fecha).toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup_caja_${fechaArchivo}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function redescargarCierre(idx) {
    const cierre = closingHistory[idx];
    if (cierre) descargarBackupJSON(cierre);
}

function renderClosingInto(bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;

    if (closingHistory.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-gray-400 text-xs">Sin cierres registrados.</td></tr>`;
        return;
    }

    body.innerHTML = closingHistory.map((c, idx) => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-3 text-gray-400">${c.fecha ? new Date(c.fecha).toLocaleString() : '--'}</td>
            <td class="p-3 uppercase font-bold">${c.usuario || '--'}</td>
            <td class="p-3 text-center">${c.num_transacciones}</td>
            <td class="p-3">Bs. ${parseFloat(c.total_descuentos || 0).toFixed(2)}</td>
            <td class="p-3 font-bold text-secondary">Bs. ${parseFloat(c.total_ventas || 0).toFixed(2)}</td>
            <td class="p-3"><button onclick="redescargarCierre(${idx})" class="bg-gray-100 text-gray-700 p-1 px-2 rounded hover:bg-secondary hover:text-white transition text-[10px]"><i class="fas fa-download"></i></button></td>
        </tr>
    `).join('');
}

function renderAllClosingTables() {
    renderClosingInto('store-closing-table-body');
    renderClosingInto('admin-closing-table-body');
}

// ==========================================
// 8. PANEL DE ADMINISTRACIÓN
// ==========================================
function switchAdminTab(tab) {
    ['dashboard', 'inventario', 'categorias', 'caja'].forEach(t => {
        document.getElementById(`sub-admin-${t}`).classList.add("hidden");
        document.getElementById(`tab-btn-${t}`).classList.remove("bg-blue-800", "text-white");
        document.getElementById(`tab-btn-${t}`).classList.add("text-gray-300");
    });
    document.getElementById(`sub-admin-${tab}`).classList.remove("hidden");
    document.getElementById(`tab-btn-${tab}`).classList.add("bg-blue-800", "text-white");

    if (tab === 'inventario') renderInventoryTable();
    if (tab === 'categorias') renderCategoriesAdminList();
    if (tab === 'caja') { renderAllHistoryTables(); renderAllClosingTables(); }
}

function updateAdminDashboard() {
    const dashGanancias = document.getElementById("dash-ganancias");
    const dashAlertas = document.getElementById("dash-alertas");

    if (dashGanancias) {
        const sum = boxHistory.reduce((a, b) => a + parseFloat(b.monto || 0), 0);
        dashGanancias.innerText = `Bs. ${sum.toFixed(2)}`;
    }
    if (dashAlertas) {
        const count = products.filter(p => p.stock <= STOCK_ALERTA_MINIMO).length;
        dashAlertas.innerText = `${count} Productos`;
    }
}

function renderInventoryTable() {
    const body = document.getElementById("table-inventory-body");
    if (!body) return;

    if (products.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-400 text-xs">Sin herramientas.</td></tr>`;
        return;
    }

    body.innerHTML = products.map(p => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-4 font-mono font-bold">${p.code}</td>
            <td class="p-4"><img src="${p.img || ''}" class="w-8 h-8 object-cover rounded border"></td>
            <td class="p-4 font-medium text-gray-900">${p.name}</td>
            <td class="p-4 uppercase text-gray-400 font-bold">${getCategoryName(p.category)}</td>
            <td class="p-4 font-bold text-secondary">Bs. ${parseFloat(p.price).toFixed(2)}</td>
            <td class="p-4"><span class="font-mono font-bold px-2 py-0.5 rounded ${p.stock <= STOCK_ALERTA_MINIMO ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}">${p.stock} pzas</span></td>
            <td class="p-4">
                <button onclick="deleteProduct(${p.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

// ==========================================
// 9. CATEGORÍAS (ETIQUETAS DE PRODUCTO)
// ==========================================
function slugify(text) {
    return text
        .toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function populateCategorySelect() {
    const select = document.getElementById("prod-category-select");
    if (!select) return;
    const validCats = categories.filter(c => c.id !== 'all');
    const currentVal = select.value;
    select.innerHTML = validCats.length
        ? validCats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
        : `<option value="" disabled selected>Crea una categoría primero (+)</option>`;
    if (validCats.some(c => c.id === currentVal)) select.value = currentVal;
}

function openCategoryModal() {
    document.getElementById("category-form-modal").classList.remove("hidden");
}

function closeCategoryModal() {
    document.getElementById("category-form-modal").classList.add("hidden");
    document.getElementById("category-form").reset();
}

async function handleSaveCategory(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const nameInput = document.getElementById("cat-name");
    const name = nameInput.value.trim();
    if (!name) return;

    const id = slugify(name);
    if (!id) {
        alert("Nombre de categoría inválido.");
        return;
    }
    if (categories.some(c => c.id === id)) {
        alert("Ya existe una categoría con un nombre muy similar.");
        return;
    }

    try {
        const { error } = await supabaseClient.from('categories').insert([{ id, name }]);
        if (error) throw error;
        closeCategoryModal();
        await refreshCategoriesOnly();
    } catch (error) {
        alert("Error al guardar categoría: " + error.message);
    }
}

async function deleteCategory(id) {
    if (!supabaseClient) return;
    if (!confirm("¿Eliminar esta categoría? Los productos que la usan quedarán marcados como 'Varios'.")) return;
    try {
        const { error } = await supabaseClient.from('categories').delete().eq('id', id);
        if (error) throw error;
        await refreshCategoriesOnly();
    } catch (error) {
        alert("Error al eliminar: " + error.message);
    }
}

function renderCategoriesAdminList() {
    const body = document.getElementById("categories-admin-list");
    if (!body) return;
    const validCats = categories.filter(c => c.id !== 'all');

    if (validCats.length === 0) {
        body.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-400 text-xs">Aún no hay categorías. Crea la primera con el botón "Nueva Categoría".</td></tr>`;
        return;
    }

    body.innerHTML = validCats.map(c => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-3 font-mono text-gray-400">${c.id}</td>
            <td class="p-3 font-bold uppercase">${c.name}</td>
            <td class="p-3"><button onclick="deleteCategory('${c.id}')" class="text-red-500 hover:text-red-700"><i class="fas fa-trash-alt"></i></button></td>
        </tr>
    `).join('');
}

// ==========================================
// 10. AGREGAR / ELIMINAR PRODUCTOS (CON IMAGEN LOCAL U URL)
// ==========================================
function openNewProductModal() {
    populateCategorySelect();
    pendingLocalImageData = null;
    document.getElementById("prod-img-file").value = '';
    document.getElementById("prod-img-url").value = '';
    document.getElementById("img-preview").classList.add("hidden");
    setImageMode('local');
    document.getElementById("product-form-modal").classList.remove("hidden");
}

function closeNewProductModal() {
    document.getElementById("product-form-modal").classList.add("hidden");
}

function setImageMode(mode) {
    currentImgMode = mode;
    const btnLocal = document.getElementById("img-mode-local");
    const btnUrl = document.getElementById("img-mode-url");
    const boxLocal = document.getElementById("img-input-local");
    const boxUrl = document.getElementById("img-input-url");
    if (!btnLocal || !btnUrl || !boxLocal || !boxUrl) return;

    if (mode === 'local') {
        boxLocal.classList.remove("hidden");
        boxUrl.classList.add("hidden");
        btnLocal.classList.add("bg-primary", "text-white");
        btnLocal.classList.remove("bg-gray-100", "text-gray-500");
        btnUrl.classList.remove("bg-primary", "text-white");
        btnUrl.classList.add("bg-gray-100", "text-gray-500");
    } else {
        boxUrl.classList.remove("hidden");
        boxLocal.classList.add("hidden");
        btnUrl.classList.add("bg-primary", "text-white");
        btnUrl.classList.remove("bg-gray-100", "text-gray-500");
        btnLocal.classList.remove("bg-primary", "text-white");
        btnLocal.classList.add("bg-gray-100", "text-gray-500");
    }
}

function handleLocalImageSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert("Por favor selecciona un archivo de imagen válido.");
        return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            if (width > MAX_IMG_WIDTH) {
                height = Math.round(height * (MAX_IMG_WIDTH / width));
                width = MAX_IMG_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            pendingLocalImageData = canvas.toDataURL('image/jpeg', 0.75);

            const preview = document.getElementById("img-preview");
            preview.src = pendingLocalImageData;
            preview.classList.remove("hidden");
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleSaveProduct(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const code = document.getElementById('prod-code').value.trim();
    const name = document.getElementById('prod-name').value.trim();
    const price = parseFloat(document.getElementById('prod-price').value);
    const stock = parseInt(document.getElementById('prod-stock').value, 10);
    const category = document.getElementById('prod-category-select').value;

    let img = '';
    if (currentImgMode === 'local') {
        img = pendingLocalImageData || '';
    } else {
        img = document.getElementById('prod-img-url').value.trim();
    }

    if (!category) {
        alert("Crea o selecciona una categoría/etiqueta para el producto.");
        return;
    }
    if (!img) {
        alert("Agrega una imagen del producto (desde tu PC o por URL).");
        return;
    }

    try {
        const { error } = await supabaseClient.from('products').insert([{ code, name, price, stock, category, img }]);
        if (error) throw error;
        closeNewProductModal();
        e.target.reset();
        pendingLocalImageData = null;
        document.getElementById("img-preview").classList.add("hidden");
        loadInitialData();
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
}

async function deleteProduct(id) {
    if (!supabaseClient) return;
    if (confirm("¿Eliminar este artículo permanentemente?")) {
        try {
            const { error } = await supabaseClient.from('products').delete().eq('id', id);
            if (error) throw error;
            loadInitialData();
        } catch (error) {
            alert("Error: " + error.message);
        }
    }
}

// ==========================================
// 11. ESCÁNER DE CÓDIGO DE BARRAS (ABRE LA CÁMARA)
// ==========================================
function onScanSuccess(decodedText) {
    closeScannerModal();
    const found = products.find(p => String(p.code) === decodedText.trim());
    if (found) {
        addToCart(found.id);
    } else {
        alert(`Código [${decodedText}] no registrado.`);
    }
}

function openScannerModal() {
    document.getElementById("scanner-modal").classList.remove("hidden");
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5QrcodeScanner("interactive-scanner", { fps: 15, qrbox: { width: 250, height: 120 } }, false);
    }
    html5QrcodeScanner.render(onScanSuccess, (err) => { /* ignorar errores de lectura frame a frame */ });
}

function closeScannerModal() {
    document.getElementById("scanner-modal").classList.add("hidden");
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(err => console.error(err));
    }
=======
// ==========================================
// 0. ESTADO GLOBAL
// ==========================================
let products = [];
let categories = [];
let cart = [];
let boxHistory = [];
let closingHistory = [];
let currentCategory = 'all';
let currentUserRole = '';
let html5QrcodeScanner = null;
let pendingLocalImageData = null; // imagen (base64) subida desde la PC, pendiente de guardar
let currentImgMode = 'local';      // 'local' | 'url'

const STOCK_ALERTA_MINIMO = 5;
const MAX_IMG_WIDTH = 480; // ancho máximo (px) al comprimir imágenes locales antes de guardarlas

// ==========================================
// 1. CONFIGURACIÓN Y CONEXIÓN A SUPABASE
// ==========================================
const SUPABASE_URL = "https://bwigwybxzmmvypwfwuvh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3aWd3eWJ4em1tdnlwd2Z3dXZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDk5NDksImV4cCI6MjA5NzkyNTk0OX0.f5ZFY3G3ysdziQFpiIIbJSUsioMmMFz0VTGoi-Nn8gM";

const supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function') ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ==========================================
// 2. EVENTOS PRINCIPALES Y LOGIN (¡Desvinculado del HTML!)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    console.log("✅ DOM Cargado. Vinculando botón de login...");

    // Capturamos el formulario por su ID
    const formLogin = document.getElementById("form-login");

    if (formLogin) {
        formLogin.addEventListener("submit", function(e) {
            e.preventDefault(); // Evita que la página intente recargarse
            console.log("🔑 Procesando ingreso...");

            const user = document.getElementById("login-user").value.trim().toLowerCase();
            const pass = document.getElementById("login-pass").value;
            const errorDiv = document.getElementById("login-error");

            if ((user === "caja" && pass === "1234") || (user === "admin" && pass === "yosoy")) {
                currentUserRole = user;
                errorDiv.classList.add("hidden");
                document.getElementById("view-login").classList.add("hidden");
                document.getElementById("view-store").classList.remove("hidden");

                const btnAdmin = document.getElementById("btn-to-admin");
                if (user === "admin") {
                    btnAdmin.classList.remove("hidden");
                } else {
                    btnAdmin.classList.add("hidden");
                }
            } else {
                errorDiv.classList.remove("hidden");
            }
        });
    } else {
        console.error("❌ No se encontró el formulario 'form-login' en el HTML.");
    }

    // Estado inicial del selector de imagen (local por defecto)
    setImageMode('local');

    // Iniciar carga de datos a la base
    loadInitialData();
    listenRealtimeChanges();
});

function handleLogout() {
    currentUserRole = '';
    cart = [];
    updateCartUI();
    document.getElementById("view-store").classList.add("hidden");
    document.getElementById("view-admin").classList.add("hidden");
    document.getElementById("view-login").classList.remove("hidden");
    document.getElementById("login-user").value = '';
    document.getElementById("login-pass").value = '';
}

// ==========================================
// 3. MÓDULO DE SINCRONIZACIÓN (SUPABASE)
// ==========================================
async function loadInitialData() {
    if (!supabaseClient) return;
    try {
        const { data: catData, error: catErr } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
        if (catErr) throw catErr;
        categories = [{ id: "all", name: "Todos" }, ...(catData || [])];

        const { data: prodData, error: prodErr } = await supabaseClient.from('products').select('*').order('name', { ascending: true });
        if (prodErr) throw prodErr;
        products = prodData || [];

        const { data: histData, error: histErr } = await supabaseClient.from('box_history').select('*').order('fecha', { ascending: false });
        if (histErr) throw histErr;
        boxHistory = histData || [];

        // La tabla de cierres de caja es nueva: si todavía no la creaste en Supabase, no rompemos la app.
        const { data: cierreData, error: cierreErr } = await supabaseClient.from('cierres_caja').select('*').order('fecha', { ascending: false });
        if (cierreErr) {
            console.warn("No se pudo cargar 'cierres_caja' (¿falta crear la tabla? revisa supabase_setup.sql):", cierreErr.message);
            closingHistory = [];
        } else {
            closingHistory = cierreData || [];
        }

        renderCategoriesUI();
        renderStoreProducts();
        renderInventoryTable();
        renderCategoriesAdminList();
        populateCategorySelect();
        updateAdminDashboard();
        renderAllHistoryTables();
        renderAllClosingTables();
    } catch (error) {
        console.error("Error cargando datos:", error.message);
    }
}

async function refreshCategoriesOnly() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
    if (!error) {
        categories = [{ id: "all", name: "Todos" }, ...(data || [])];
        renderCategoriesUI();
        renderCategoriesAdminList();
        populateCategorySelect();
        renderStoreProducts();
        renderInventoryTable();
    }
}

function listenRealtimeChanges() {
    if (!supabaseClient) return;
    supabaseClient
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
            if (payload.eventType === 'UPDATE') {
                const idx = products.findIndex(p => p.id === payload.new.id);
                if (idx !== -1) products[idx] = payload.new;
            } else if (payload.eventType === 'INSERT') {
                products.push(payload.new);
            } else if (payload.eventType === 'DELETE') {
                products = products.filter(p => p.id !== payload.old.id);
            }
            renderStoreProducts();
            renderInventoryTable();
            updateAdminDashboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
            refreshCategoriesOnly();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'box_history' }, (payload) => {
            boxHistory.unshift(payload.new);
            renderAllHistoryTables();
            updateAdminDashboard();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cierres_caja' }, (payload) => {
            closingHistory.unshift(payload.new);
            renderAllClosingTables();
        })
        .subscribe();
}

function switchView(view) {
    if (view === 'admin' && currentUserRole !== 'admin') {
        alert("Acceso denegado.");
        return;
    }
    if (view === 'admin') {
        document.getElementById("view-store").classList.add("hidden");
        document.getElementById("view-admin").classList.remove("hidden");
        switchAdminTab('dashboard');
    } else {
        document.getElementById("view-admin").classList.add("hidden");
        document.getElementById("view-store").classList.remove("hidden");
    }
}

// ==========================================
// 4. INTERFAZ DEL PUNTO DE VENTA (TIENDA)
// ==========================================
function renderCategoriesUI() {
    const container = document.getElementById("store-categories-bar");
    if (!container) return;
    container.innerHTML = categories.map(cat => `
        <button onclick="filterByCategory('${cat.id}')" 
                class="px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${currentCategory === cat.id ? 'bg-primary text-white shadow-sm' : 'bg-white text-gray-600 hover:bg-gray-100 border'}">
            ${cat.name}
        </button>
    `).join('');
}

function filterByCategory(catId) {
    currentCategory = catId;
    renderCategoriesUI();
    renderStoreProducts();
}

function filterProducts() {
    renderStoreProducts();
}

function renderStoreProducts() {
    const grid = document.getElementById("product-grid");
    const searchVal = document.getElementById("search-input").value.toLowerCase().trim();
    if (!grid) return;

    let filtered = products;

    if (currentCategory !== 'all') {
        filtered = filtered.filter(p => p.category === currentCategory);
    }

    if (searchVal) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchVal) || String(p.code).includes(searchVal));
    }

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-8 text-gray-400 text-xs">No se encontraron herramientas.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(p => {
        const isLowStock = p.stock <= STOCK_ALERTA_MINIMO;
        const isOut = p.stock <= 0;

        return `
            <div class="bg-white rounded-xl shadow-xs border border-gray-100 overflow-hidden flex flex-col justify-between p-3 group relative hover:shadow-md transition">
                ${isLowStock ? `<span class="absolute top-2 left-2 z-10 text-[9px] font-black uppercase tracking-wider ${isOut ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'} px-2 py-0.5 rounded-md">${isOut ? 'Agotado' : 'Stock Bajo'}</span>` : ''}
                <div class="w-full h-28 bg-gray-50 rounded-lg overflow-hidden mb-2 flex items-center justify-center">
                    <img src="${p.img || 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=300&q=80'}" class="object-cover w-full h-full group-hover:scale-105 transition duration-300">
                </div>
                <div>
                    <p class="text-[10px] font-bold text-gray-400 uppercase">${getCategoryName(p.category)}</p>
                    <h4 class="font-bold text-gray-800 text-xs line-clamp-2 mt-0.5 min-h-[32px]">${p.name}</h4>
                    <span class="text-[10px] text-gray-400 font-mono block mt-0.5">Cód: ${p.code}</span>
                </div>
                <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                    <div>
                        <span class="text-[10px] text-gray-400 block leading-tight">Precio</span>
                        <span class="text-xs font-black text-secondary">Bs. ${parseFloat(p.price).toFixed(2)}</span>
                    </div>
                    <button onclick="addToCart(${p.id})" ${isOut ? 'disabled' : ''} 
                            class="bg-secondary text-white text-xs font-bold px-2.5 py-1.5 rounded-lg hover:bg-primary transition disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                        <i class="fas fa-plus text-[10px] mr-1"></i>Añadir
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function getCategoryName(catId) {
    const found = categories.find(c => c.id === catId);
    return found ? found.name : 'Varios';
}

// ==========================================
// 5. CONTROL DEL CARRITO DE COMPRAS
// ==========================================
function toggleCart() {
    document.getElementById("cart-modal").classList.toggle("hidden");
}

function addToCart(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    const cartItem = cart.find(item => item.id === id);
    if (cartItem) {
        if (cartItem.qty >= product.stock) {
            alert(`Límite de stock alcanzado: ${product.stock} unidades.`);
            return;
        }
        cartItem.qty++;
    } else {
        if (product.stock <= 0) {
            alert("No hay existencias.");
            return;
        }
        cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
}

function updateCartQty(id, change) {
    const item = cart.find(i => i.id === id);
    const product = products.find(p => p.id === id);
    if (!item || !product) return;

    if (change > 0 && item.qty >= product.stock) {
        alert("Stock máximo alcanzado.");
        return;
    }

    item.qty += change;
    if (item.qty <= 0) {
        cart = cart.filter(i => i.id !== id);
    }
    updateCartUI();
}

function getCartSubtotal() {
    return cart.reduce((a, b) => a + (parseFloat(b.price) * b.qty), 0);
}

function updateCartUI() {
    const countSpan = document.getElementById("cart-count");
    const container = document.getElementById("cart-items");
    const totalSpan = document.getElementById("cart-total");

    if (!countSpan || !container || !totalSpan) return;

    const totalCount = cart.reduce((a, b) => a + b.qty, 0);
    countSpan.innerText = totalCount;

    if (cart.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-gray-300"><p class="text-xs font-bold">La orden está vacía</p></div>`;
        totalSpan.innerText = "Bs. 0.00";
        return;
    }

    container.innerHTML = cart.map(item => `
        <div class="flex items-center justify-between bg-gray-50 p-2 rounded-xl border border-gray-100">
            <div class="flex-1 min-w-0 pr-2">
                <h5 class="font-bold text-xs text-gray-800 truncate">${item.name}</h5>
                <p class="text-[10px] text-gray-400">Bs. ${parseFloat(item.price).toFixed(2)} c/u</p>
            </div>
            <div class="flex items-center space-x-2">
                <div class="flex items-center bg-white border rounded-lg px-1">
                    <button onclick="updateCartQty(${item.id}, -1)" class="text-gray-400 hover:text-red-500 px-1 font-bold">-</button>
                    <span class="px-2 text-xs font-mono font-bold">${item.qty}</span>
                    <button onclick="updateCartQty(${item.id}, 1)" class="text-gray-400 hover:text-green-500 px-1 font-bold">+</button>
                </div>
                <span class="text-xs font-bold text-secondary min-w-[55px] text-right">Bs. ${(item.price * item.qty).toFixed(2)}</span>
            </div>
        </div>
    `).join('');

    totalSpan.innerText = `Bs. ${getCartSubtotal().toFixed(2)}`;
}

function openCustomerModal() {
    if (cart.length === 0) {
        alert("Agregue ítems al carrito.");
        return;
    }
    document.getElementById("discount-input").value = 0;
    updateCheckoutPreview();
    document.getElementById("customer-modal").classList.remove("hidden");
}

function closeCustomerModal() {
    document.getElementById("customer-modal").classList.add("hidden");
}

function updateCheckoutPreview() {
    const subtotal = getCartSubtotal();
    let pct = parseFloat(document.getElementById("discount-input").value) || 0;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    const montoDescuento = subtotal * (pct / 100);
    const total = subtotal - montoDescuento;

    document.getElementById("checkout-subtotal").innerText = `Bs. ${subtotal.toFixed(2)}`;
    document.getElementById("checkout-discount-amount").innerText = `- Bs. ${montoDescuento.toFixed(2)}`;
    document.getElementById("checkout-total-final").innerText = `Bs. ${total.toFixed(2)}`;
}

// ==========================================
// 6. PROCESO DE VENTA Y TICKETS
// ==========================================
async function processOrder(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerText : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = "Procesando..."; }

    try {
        const type = document.querySelector('input[name="doc-type"]:checked').value;
        const name = document.getElementById('cli-name').value.toUpperCase().trim();
        const doc = document.getElementById('cli-doc').value.trim();

        let descuentoPct = parseFloat(document.getElementById('discount-input').value) || 0;
        if (descuentoPct < 0) descuentoPct = 0;
        if (descuentoPct > 100) descuentoPct = 100;

        const subtotal = getCartSubtotal();
        const descuentoMonto = subtotal * (descuentoPct / 100);
        const total = subtotal - descuentoMonto;

        // 1) Releemos el stock REAL desde la base de datos (nunca confiamos solo en la caché local).
        //    Esto evita el bug de "el stock no baja" cuando el valor en pantalla está desactualizado.
        const ids = cart.map(i => i.id);
        const { data: liveProducts, error: liveErr } = await supabaseClient
            .from('products')
            .select('id, stock, name')
            .in('id', ids);
        if (liveErr) throw liveErr;

        // 2) Validamos que haya stock suficiente para TODO el carrito antes de cobrar nada.
        const faltantes = [];
        for (const item of cart) {
            const live = liveProducts.find(p => p.id === item.id);
            const stockReal = live ? Number(live.stock) : 0;
            if (stockReal < item.qty) {
                faltantes.push(`${item.name} (disponible: ${stockReal}, solicitado: ${item.qty})`);
            }
        }
        if (faltantes.length > 0) {
            alert("No se puede completar la venta, stock insuficiente para:\n" + faltantes.join("\n"));
            return;
        }

        // 3) Descontamos el stock producto por producto, verificando que el UPDATE
        //    realmente afectó una fila. Si "updated" llega vacío (sin error), normalmente
        //    significa que falta una política RLS de UPDATE para el rol "anon" en Supabase.
        for (const item of cart) {
            const live = liveProducts.find(p => p.id === item.id);
            const stockReal = Number(live.stock);
            const nuevoStock = Math.max(0, stockReal - item.qty);

            const { data: updated, error: stockErr } = await supabaseClient
                .from('products')
                .update({ stock: nuevoStock })
                .eq('id', item.id)
                .select('id, stock');

            if (stockErr) throw stockErr;
            if (!updated || updated.length === 0) {
                throw new Error(`El stock de "${item.name}" no se pudo actualizar (la base de datos no devolvió cambios). Revisa que la tabla "products" tenga una política RLS de UPDATE habilitada para el rol anon en Supabase — ver supabase_setup.sql.`);
            }
        }

        const transaction = {
            id: "TX-" + Date.now(),
            cliente: name,
            documento: doc,
            tipo: type,
            subtotal: subtotal,
            descuento_pct: descuentoPct,
            descuento_monto: descuentoMonto,
            monto: total,
            detalles: [...cart],
            usuario: currentUserRole
        };

        const { error: txErr } = await supabaseClient.from('box_history').insert([transaction]);
        if (txErr) throw txErr;

        generarHojaImpresion(transaction);

        cart = [];
        updateCartUI();
        closeCustomerModal();
        toggleCart();
        e.target.reset();

        loadInitialData();
    } catch (error) {
        alert("Error crítico: " + error.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = originalBtnText || "Emitir Comprobante"; }
    }
}

function generarHojaImpresion(tx) {
    const ventana = window.open('', '_blank');
    const detalles = tx.detalles || [];
    const subtotal = tx.subtotal !== undefined && tx.subtotal !== null ? parseFloat(tx.subtotal) : detalles.reduce((a, b) => a + (b.price * b.qty), 0);
    const descuentoMonto = tx.descuento_monto !== undefined && tx.descuento_monto !== null ? parseFloat(tx.descuento_monto) : 0;
    const descuentoPct = tx.descuento_pct !== undefined && tx.descuento_pct !== null ? parseFloat(tx.descuento_pct) : 0;
    const total = tx.monto !== undefined && tx.monto !== null ? parseFloat(tx.monto) : subtotal;

    ventana.document.write(`
        <html>
        <head>
            <title>Comprobante ${tx.id}</title>
            <style>
                body { font-family: monospace; width: 72mm; margin: 0 auto; font-size: 11px; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .linea { border-top: 1px dashed #000; margin: 4px 0; }
                table { width: 100%; border-collapse: collapse; }
                .bold { font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <strong>SOL NACIENTE</strong><br>Ferretería - Oruro, Bolivia<br>
                <strong>${tx.tipo.toUpperCase()}</strong><br>Nro: ${tx.id}
            </div>
            <div class="linea"></div>
            <div>FECHA: ${new Date().toLocaleString()}<br>CLIENTE: ${tx.cliente}<br>NIT/CI: ${tx.documento}</div>
            <div class="linea"></div>
            <table>
                ${detalles.map(i => `
                    <tr>
                        <td>${i.qty}x ${String(i.name).substring(0, 18)}</td>
                        <td class="text-right">Bs. ${(i.price * i.qty).toFixed(2)}</td>
                    </tr>
                `).join('')}
            </table>
            <div class="linea"></div>
            <table>
                <tr><td>Subtotal</td><td class="text-right">Bs. ${subtotal.toFixed(2)}</td></tr>
                ${descuentoMonto > 0 ? `<tr><td>Descuento (${descuentoPct}%)</td><td class="text-right">- Bs. ${descuentoMonto.toFixed(2)}</td></tr>` : ''}
            </table>
            <div class="linea"></div>
            <div class="text-right bold">TOTAL: Bs. ${total.toFixed(2)}</div>
            <script>window.print(); window.close();</script>
        </body>
        </html>
    `);
    ventana.document.close();
}

function toggleStoreHistory() {
    const sec = document.getElementById("store-history-section");
    sec.classList.toggle("hidden");
}

function renderHistoryInto(bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;

    if (boxHistory.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-gray-400 text-xs">Sin registros.</td></tr>`;
        return;
    }

    body.innerHTML = boxHistory.map(tx => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-3 font-mono font-bold text-secondary">${tx.id}</td>
            <td class="p-3 text-gray-400">${tx.fecha ? tx.fecha.substring(11, 16) : '--:--'}</td>
            <td class="p-3 uppercase truncate max-w-[120px]">${tx.cliente}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">${tx.tipo}</span></td>
            <td class="p-3 font-bold">Bs. ${parseFloat(tx.monto).toFixed(2)}</td>
            <td class="p-3">
                <button onclick="reimprimirTicket('${tx.id}')" class="bg-gray-100 text-gray-700 p-1 px-2 rounded hover:bg-secondary hover:text-white transition text-[10px]">Copia</button>
            </td>
        </tr>
    `).join('');
}

function renderAllHistoryTables() {
    renderHistoryInto('store-history-table-body');
    renderHistoryInto('admin-history-table-body');
}

function reimprimirTicket(id) {
    const tx = boxHistory.find(t => t.id === id);
    if (tx) generarHojaImpresion(tx);
}

// ==========================================
// 7. CIERRE DE CAJA Y RESPALDOS (BACKUPS)
// ==========================================
function getUltimoCierreFecha() {
    if (closingHistory.length === 0) return null;
    return closingHistory[0].fecha;
}

function getVentasPendientesDeCierre() {
    const ultimaFecha = getUltimoCierreFecha();
    if (!ultimaFecha) return [...boxHistory];
    const corte = new Date(ultimaFecha).getTime();
    return boxHistory.filter(tx => tx.fecha && new Date(tx.fecha).getTime() > corte);
}

async function cerrarCaja() {
    const pendientes = getVentasPendientesDeCierre();
    if (pendientes.length === 0) {
        alert("No hay ventas nuevas desde el último cierre de caja.");
        return;
    }
    if (!confirm(`Se cerrará la caja con ${pendientes.length} venta(s) registradas desde el último cierre. Se generará un respaldo descargable. ¿Continuar?`)) return;

    const totalVentas = pendientes.reduce((a, b) => a + parseFloat(b.monto || 0), 0);
    const totalDescuentos = pendientes.reduce((a, b) => a + parseFloat(b.descuento_monto || 0), 0);

    const cierre = {
        fecha: new Date().toISOString(),
        usuario: currentUserRole || 'desconocido',
        num_transacciones: pendientes.length,
        total_ventas: totalVentas,
        total_descuentos: totalDescuentos,
        snapshot: pendientes
    };

    try {
        if (supabaseClient) {
            const { error } = await supabaseClient.from('cierres_caja').insert([cierre]);
            if (error) throw error;
        }
        descargarBackupJSON(cierre);
        alert("Caja cerrada con éxito. Se descargó el respaldo de la jornada en tu carpeta de descargas.");
        loadInitialData();
    } catch (error) {
        alert("Error al cerrar caja: " + error.message + "\n\n¿Creaste la tabla 'cierres_caja' en Supabase? Revisa el archivo supabase_setup.sql.");
    }
}

function descargarBackupJSON(cierre) {
    const blob = new Blob([JSON.stringify(cierre, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fechaArchivo = new Date(cierre.fecha).toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup_caja_${fechaArchivo}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function redescargarCierre(idx) {
    const cierre = closingHistory[idx];
    if (cierre) descargarBackupJSON(cierre);
}

function renderClosingInto(bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;

    if (closingHistory.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-gray-400 text-xs">Sin cierres registrados.</td></tr>`;
        return;
    }

    body.innerHTML = closingHistory.map((c, idx) => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-3 text-gray-400">${c.fecha ? new Date(c.fecha).toLocaleString() : '--'}</td>
            <td class="p-3 uppercase font-bold">${c.usuario || '--'}</td>
            <td class="p-3 text-center">${c.num_transacciones}</td>
            <td class="p-3">Bs. ${parseFloat(c.total_descuentos || 0).toFixed(2)}</td>
            <td class="p-3 font-bold text-secondary">Bs. ${parseFloat(c.total_ventas || 0).toFixed(2)}</td>
            <td class="p-3"><button onclick="redescargarCierre(${idx})" class="bg-gray-100 text-gray-700 p-1 px-2 rounded hover:bg-secondary hover:text-white transition text-[10px]"><i class="fas fa-download"></i></button></td>
        </tr>
    `).join('');
}

function renderAllClosingTables() {
    renderClosingInto('store-closing-table-body');
    renderClosingInto('admin-closing-table-body');
}

// ==========================================
// 8. PANEL DE ADMINISTRACIÓN
// ==========================================
function switchAdminTab(tab) {
    ['dashboard', 'inventario', 'categorias', 'caja'].forEach(t => {
        document.getElementById(`sub-admin-${t}`).classList.add("hidden");
        document.getElementById(`tab-btn-${t}`).classList.remove("bg-blue-800", "text-white");
        document.getElementById(`tab-btn-${t}`).classList.add("text-gray-300");
    });
    document.getElementById(`sub-admin-${tab}`).classList.remove("hidden");
    document.getElementById(`tab-btn-${tab}`).classList.add("bg-blue-800", "text-white");

    if (tab === 'inventario') renderInventoryTable();
    if (tab === 'categorias') renderCategoriesAdminList();
    if (tab === 'caja') { renderAllHistoryTables(); renderAllClosingTables(); }
}

function updateAdminDashboard() {
    const dashGanancias = document.getElementById("dash-ganancias");
    const dashAlertas = document.getElementById("dash-alertas");

    if (dashGanancias) {
        const sum = boxHistory.reduce((a, b) => a + parseFloat(b.monto || 0), 0);
        dashGanancias.innerText = `Bs. ${sum.toFixed(2)}`;
    }
    if (dashAlertas) {
        const count = products.filter(p => p.stock <= STOCK_ALERTA_MINIMO).length;
        dashAlertas.innerText = `${count} Productos`;
    }
}

function renderInventoryTable() {
    const body = document.getElementById("table-inventory-body");
    if (!body) return;

    if (products.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-400 text-xs">Sin herramientas.</td></tr>`;
        return;
    }

    body.innerHTML = products.map(p => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-4 font-mono font-bold">${p.code}</td>
            <td class="p-4"><img src="${p.img || ''}" class="w-8 h-8 object-cover rounded border"></td>
            <td class="p-4 font-medium text-gray-900">${p.name}</td>
            <td class="p-4 uppercase text-gray-400 font-bold">${getCategoryName(p.category)}</td>
            <td class="p-4 font-bold text-secondary">Bs. ${parseFloat(p.price).toFixed(2)}</td>
            <td class="p-4"><span class="font-mono font-bold px-2 py-0.5 rounded ${p.stock <= STOCK_ALERTA_MINIMO ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}">${p.stock} pzas</span></td>
            <td class="p-4">
                <button onclick="deleteProduct(${p.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');
}

// ==========================================
// 9. CATEGORÍAS (ETIQUETAS DE PRODUCTO)
// ==========================================
function slugify(text) {
    return text
        .toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function populateCategorySelect() {
    const select = document.getElementById("prod-category-select");
    if (!select) return;
    const validCats = categories.filter(c => c.id !== 'all');
    const currentVal = select.value;
    select.innerHTML = validCats.length
        ? validCats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
        : `<option value="" disabled selected>Crea una categoría primero (+)</option>`;
    if (validCats.some(c => c.id === currentVal)) select.value = currentVal;
}

function openCategoryModal() {
    document.getElementById("category-form-modal").classList.remove("hidden");
}

function closeCategoryModal() {
    document.getElementById("category-form-modal").classList.add("hidden");
    document.getElementById("category-form").reset();
}

async function handleSaveCategory(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const nameInput = document.getElementById("cat-name");
    const name = nameInput.value.trim();
    if (!name) return;

    const id = slugify(name);
    if (!id) {
        alert("Nombre de categoría inválido.");
        return;
    }
    if (categories.some(c => c.id === id)) {
        alert("Ya existe una categoría con un nombre muy similar.");
        return;
    }

    try {
        const { error } = await supabaseClient.from('categories').insert([{ id, name }]);
        if (error) throw error;
        closeCategoryModal();
        await refreshCategoriesOnly();
    } catch (error) {
        alert("Error al guardar categoría: " + error.message);
    }
}

async function deleteCategory(id) {
    if (!supabaseClient) return;
    if (!confirm("¿Eliminar esta categoría? Los productos que la usan quedarán marcados como 'Varios'.")) return;
    try {
        const { error } = await supabaseClient.from('categories').delete().eq('id', id);
        if (error) throw error;
        await refreshCategoriesOnly();
    } catch (error) {
        alert("Error al eliminar: " + error.message);
    }
}

function renderCategoriesAdminList() {
    const body = document.getElementById("categories-admin-list");
    if (!body) return;
    const validCats = categories.filter(c => c.id !== 'all');

    if (validCats.length === 0) {
        body.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-400 text-xs">Aún no hay categorías. Crea la primera con el botón "Nueva Categoría".</td></tr>`;
        return;
    }

    body.innerHTML = validCats.map(c => `
        <tr class="text-xs text-gray-700 hover:bg-gray-50 border-b">
            <td class="p-3 font-mono text-gray-400">${c.id}</td>
            <td class="p-3 font-bold uppercase">${c.name}</td>
            <td class="p-3"><button onclick="deleteCategory('${c.id}')" class="text-red-500 hover:text-red-700"><i class="fas fa-trash-alt"></i></button></td>
        </tr>
    `).join('');
}

// ==========================================
// 10. AGREGAR / ELIMINAR PRODUCTOS (CON IMAGEN LOCAL U URL)
// ==========================================
function openNewProductModal() {
    populateCategorySelect();
    pendingLocalImageData = null;
    document.getElementById("prod-img-file").value = '';
    document.getElementById("prod-img-url").value = '';
    document.getElementById("img-preview").classList.add("hidden");
    setImageMode('local');
    document.getElementById("product-form-modal").classList.remove("hidden");
}

function closeNewProductModal() {
    document.getElementById("product-form-modal").classList.add("hidden");
}

function setImageMode(mode) {
    currentImgMode = mode;
    const btnLocal = document.getElementById("img-mode-local");
    const btnUrl = document.getElementById("img-mode-url");
    const boxLocal = document.getElementById("img-input-local");
    const boxUrl = document.getElementById("img-input-url");
    if (!btnLocal || !btnUrl || !boxLocal || !boxUrl) return;

    if (mode === 'local') {
        boxLocal.classList.remove("hidden");
        boxUrl.classList.add("hidden");
        btnLocal.classList.add("bg-primary", "text-white");
        btnLocal.classList.remove("bg-gray-100", "text-gray-500");
        btnUrl.classList.remove("bg-primary", "text-white");
        btnUrl.classList.add("bg-gray-100", "text-gray-500");
    } else {
        boxUrl.classList.remove("hidden");
        boxLocal.classList.add("hidden");
        btnUrl.classList.add("bg-primary", "text-white");
        btnUrl.classList.remove("bg-gray-100", "text-gray-500");
        btnLocal.classList.remove("bg-primary", "text-white");
        btnLocal.classList.add("bg-gray-100", "text-gray-500");
    }
}

function handleLocalImageSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert("Por favor selecciona un archivo de imagen válido.");
        return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            if (width > MAX_IMG_WIDTH) {
                height = Math.round(height * (MAX_IMG_WIDTH / width));
                width = MAX_IMG_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            pendingLocalImageData = canvas.toDataURL('image/jpeg', 0.75);

            const preview = document.getElementById("img-preview");
            preview.src = pendingLocalImageData;
            preview.classList.remove("hidden");
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleSaveProduct(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const code = document.getElementById('prod-code').value.trim();
    const name = document.getElementById('prod-name').value.trim();
    const price = parseFloat(document.getElementById('prod-price').value);
    const stock = parseInt(document.getElementById('prod-stock').value, 10);
    const category = document.getElementById('prod-category-select').value;

    let img = '';
    if (currentImgMode === 'local') {
        img = pendingLocalImageData || '';
    } else {
        img = document.getElementById('prod-img-url').value.trim();
    }

    if (!category) {
        alert("Crea o selecciona una categoría/etiqueta para el producto.");
        return;
    }
    if (!img) {
        alert("Agrega una imagen del producto (desde tu PC o por URL).");
        return;
    }

    try {
        const { error } = await supabaseClient.from('products').insert([{ code, name, price, stock, category, img }]);
        if (error) throw error;
        closeNewProductModal();
        e.target.reset();
        pendingLocalImageData = null;
        document.getElementById("img-preview").classList.add("hidden");
        loadInitialData();
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
}

async function deleteProduct(id) {
    if (!supabaseClient) return;
    if (confirm("¿Eliminar este artículo permanentemente?")) {
        try {
            const { error } = await supabaseClient.from('products').delete().eq('id', id);
            if (error) throw error;
            loadInitialData();
        } catch (error) {
            alert("Error: " + error.message);
        }
    }
}

// ==========================================
// 11. ESCÁNER DE CÓDIGO DE BARRAS (ABRE LA CÁMARA)
// ==========================================
function onScanSuccess(decodedText) {
    closeScannerModal();
    const found = products.find(p => String(p.code) === decodedText.trim());
    if (found) {
        addToCart(found.id);
    } else {
        alert(`Código [${decodedText}] no registrado.`);
    }
}

function openScannerModal() {
    document.getElementById("scanner-modal").classList.remove("hidden");
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5QrcodeScanner("interactive-scanner", { fps: 15, qrbox: { width: 250, height: 120 } }, false);
    }
    html5QrcodeScanner.render(onScanSuccess, (err) => { /* ignorar errores de lectura frame a frame */ });
}

function closeScannerModal() {
    document.getElementById("scanner-modal").classList.add("hidden");
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(err => console.error(err));
    }
>>>>>>> 58ab6cd (cambios)
}