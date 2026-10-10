'use strict';
// These are this service's verified public URLs. Keep explicit origins rather
// than trusting an arbitrary Host header or enabling all cross-origin access.
const PUBLIC_ORIGINS=['https://snipoclip.com','https://www.snipoclip.com','https://snipoclips.onrender.com'];
function allowedOrigins(config=''){return new Set([...PUBLIC_ORIGINS,...String(config).split(',').map(x=>x.trim()).filter(Boolean)]);}
module.exports={allowedOrigins};
