// --- Ajoute ce helper (optionnel mais conseillé) ---
function cleanRoleName(name, max = 16) {
  return String(name || "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// --- Remplace resolveMainRole par ceci ---
function resolveMainRole(member, cfg) {
  if (!member) return null;

  // 1) Si tu veux forcer "STAFF" quand membre a un rôle staff configuré (setup), garde ce bloc.
  //    Sinon supprime-le.
  const isAdmin = member.permissions?.has?.(PermissionFlagsBits.Administrator);
  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds : [];
  if (isAdmin || hasAnyRoleId(member, staffRoleIds)) {
    // NOTE: si tu veux STRICTEMENT le plus haut rôle (même admin), commente la ligne suivante.
    // return "STAFF";
  }

  // 2) Rôle le plus haut dans la hiérarchie Discord
  const roles = member.roles?.cache;
  if (!roles || roles.size === 0) return null;

  // retire @everyone
  const filtered = roles.filter((r) => r && r.id !== member.guild?.id);
  if (filtered.size === 0) return null;

  // rôle le plus haut (position max)
  const top = filtered.sort((a, b) => b.position - a.position).first();
  if (!top) return null;

  return cleanRoleName(top.name, 16) || null;
}
