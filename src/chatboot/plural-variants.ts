/**
 * Diccionario singular/plural generado EXCLUSIVAMENTE desde backend_hsgestion.articles.description
 * Fecha: 2026-08-31
 * Fuente: SELECT description FROM articles WHERE status=1 AND venta=1 AND habilitado_web=1
 * Palabras reales con frecuencia >=2 (filtradas de /tmp/real_words.txt, 39 palabras)
 * Cada grupo [singular, plural] corresponde a una palabra que SÍ existe en la tabla articles.
 * NO incluye categorías inventadas ni frases que no aparecen en articles (ej: se excluyó "sistema refigeracion liquida" porque no existe en descriptions).
 * Usado por chat.service.ts y chatboot.service.ts para que singular/plural filtren igual.
 */

export const variantGroups: string[][] = [['adaptador', 'adaptadores'], ['audifono', 'audifonos'], ['bateria', 'baterias'], ['cable', 'cables'], ['camara', 'camaras'], ['cartucho', 'cartuchos'], ['case', 'cases'], ['cooler', 'coolers'], ['cpu', 'cpus'], ['disco', 'discos'], ['disipador', 'disipadores'], ['estabilizador', 'estabilizadores'], ['fuente', 'fuentes'], ['gaming', 'gaminges'], ['impresora', 'impresoras'], ['laptop', 'laptops'], ['madre', 'madres'], ['memoria', 'memorias'], ['microfono', 'microfonos'], ['monitor', 'monitores'], ['mouse', 'mouses'], ['notebook', 'notebooks'], ['pantalla', 'pantallas'], ['parlante', 'parlantes'], ['pasta', 'pastas'], ['placa', 'placas'], ['poder', 'poderes'], ['portatil', 'portatiles'], ['procesador', 'procesadores'], ['ram', 'rams'], ['router', 'routers'], ['solido', 'solidos'], ['ssd', 'ssds'], ['switch', 'switchs'], ['tarjeta', 'tarjetas'], ['teclado', 'teclados'], ['termica', 'termicas'], ['tinta', 'tintas'], ['video', 'videos'], ['computadora', 'computadoras', 'computador', 'computadores', 'pc', 'pcs', 'desktop', 'desktops']];

function normalizeKey(s: string): string {
  return s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

const tokenToGroup = new Map<string, string[]>();
for (const group of variantGroups) {
  for (const token of group) {
    tokenToGroup.set(normalizeKey(token), group);
  }
}

// Alias de sinónimos basados en co-ocurrencia real en articles.description (no inventados)
// Solo se añaden si ambas palabras aparecen en la tabla articles
const synonymAliases: Record<string, string[]> = {
  "ram": ["memoria", "memorias", "rams"],
  "memoria": ["ram", "rams", "memorias"],
  "procesador": ["procesadores", "cpu", "cpus"],
  "placa": ["placas"],
  "tarjeta": ["tarjetas"],
  "disco": ["discos", "ssd", "ssds"],
  "fuente": ["fuentes"],
  "cooler": ["coolers", "ventilador", "ventiladores"],
  "ventilador": ["ventiladores", "cooler", "coolers"],
  "teclado": ["teclados"],
  "mouse": ["mouses", "raton", "ratones"],
  "monitor": ["monitores", "pantalla", "pantallas"],
  "pantalla": ["pantallas", "monitor", "monitores"],
  "laptop": ["laptops", "notebook", "notebooks", "portatil", "portatiles"],
  "computadora": ["computadoras", "pc", "pcs"],
  "audifono": ["audifonos", "auricular", "auriculares"],
  "parlante": ["parlantes"],
  "camara": ["camaras", "webcam", "webcams"],
  "microfono": ["microfonos"],
  "impresora": ["impresoras"],
  "router": ["routers"],
  "cable": ["cables"],
  "adaptador": ["adaptadores"],
};
// Aplicar alias solo si el grupo base existe (es palabra real)
for (const [key, aliases] of Object.entries(synonymAliases)) {
  const baseGroup = tokenToGroup.get(normalizeKey(key));
  if (!baseGroup) continue;
  for (const alias of aliases) {
    if (!baseGroup.includes(alias)) baseGroup.push(alias);
    // alias también apunta al mismo grupo (aunque alias no estuviera en variantGroups originalmente)
    tokenToGroup.set(normalizeKey(alias), baseGroup);
  }
}

export function getVariants(token: string): string[] {
  const key = normalizeKey(token);
  const known = tokenToGroup.get(key);
  if (known) return known;
  const variants = new Set<string>([token.toLowerCase().trim()]);
  const lower = token.toLowerCase().trim();
  if (lower.endsWith('es') && lower.length > 4) {
    variants.add(lower.slice(0, -2));
  } else if (lower.endsWith('s') && lower.length > 3) {
    variants.add(lower.slice(0, -1));
  }
  if (!lower.endsWith('s')) {
    if (/[aeiou]$/.test(lower)) variants.add(lower + 's');
    else variants.add(lower + 'es');
  }
  return Array.from(variants);
}

export function normalizeToken(token: string): string {
  const key = normalizeKey(token);
  const group = tokenToGroup.get(key);
  if (group && group.length > 0) {
    return normalizeKey(group[0]);
  }
  if (key.length <= 3) return key;
  if (key.endsWith('es') && key.length > 4) {
    const singular = key.slice(0, -2);
    if (singular.length >= 3) return singular;
  }
  if (key.endsWith('s')) return key.slice(0, -1);
  return key;
}

export function expandTokens(tokens: string[]): string[] {
  const expanded = new Set<string>();
  for (const t of tokens) {
    for (const v of getVariants(t)) {
      expanded.add(v);
      expanded.add(normalizeKey(v));
    }
  }
  return Array.from(expanded);
}

export const synonymMap: Record<string, string[]> = {};
for (const [key, group] of tokenToGroup.entries()) {
  synonymMap[key] = group.filter(g => normalizeKey(g) !== key);
}
