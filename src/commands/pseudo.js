// src/commands/pseudo.js
// /pseudo: show / set / apply nickname — CommonJS discord.js v14
//
// Format final (ligne) :
// PSEUDO (psn:/xbox:/ea:) ou USERNAME | RÔLE (depuis rôles staff setup) | POSTE1/2/3 (depuis posts setup)
// - Si aucun rôle staff -> champ rôle vide
// - Si aucun poste -> champ postes vide
// - /pseudo set : oblige un préfixe "psn:" / "xbox:" / "ea:"
// - /pseudo set : autorisé dans le salon pseudoScanChannelId (si défini), sinon STAFF/ADMIN partout
// - /pseudo apply : STAFF/ADMIN uniquement (évite abus)

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../core/guildConfig");
const { setUserPseudos, getUserPseudos } = require("../core/pseudoStore");

function isAdmin(member) {
  return !!member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function isStaff(member, cfg) {
  if (!member) return false;
  if (isAdmin(member)) return true;

  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds.filter(Boolean) : [];
  if (!staffRoleIds.length) return false;

  return staffRoleIds.some((id) => member.roles?.cache?.has(id));
}

function inPseudoScanChannel(interaction, cfg) {
  const scanId = cfg?.pseudoScanChannelId;
  if (!scanId) return true; // si non configuré, pas de restriction de salon
  return interaction.channelId === scanId;
}

function sanitizeValue(v) {
  return String(v || "")
    .replace(/[`|]/g, "") // évite de casser le format
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function parsePrefixedId(inputRaw) {
  const input = sanitizeValue(inputRaw).toLowerCase().replace(/\s/g, "");
  if (!input) return null;

  const m = input.match(/^(psn|xbox|ea):(.+)$/i);
  if (!m) return null;

  const platform = m[1].toLowerCase();
  const value = sanitizeValue(m[2]);
  if (!value) return null;

  return { platform, value };
}

function pickPseudoDisplay(member, pseudos) {
  const psn = pseudos?.psn ? `psn:${sanitizeValue(pseudos.psn)}` : null;
  const xbox = pseudos?.xbox ? `xbox:${sanitizeValue(pseudos.xbox)}` : null;
  const ea = pseudos?.ea ? `ea:${sanitizeValue(pseudos.ea)}` : null;

  return psn || xbox || ea || member?.user?.username || "USERNAME";
}

function pickRoleLabel(member, cfg) {
  // On prend le 1er rôle staff trouvé (ordre de cfg.staffRoleIds)
  const staffRoleIds = Array.isArray(cfg?.staffRoleIds) ? cfg.staffRoleIds.filter(Boolean) : [];
  for (const id of staffRoleIds) {
    const r = member.roles?.cache?.get(id);
    if (r) return sanitizeValue(r.name);
  }
  return ""; // champ vide si aucun
}

function pickPostLabels(member, cfg, max = 3) {
  const posts = Array.isArray(cfg?.posts) ? cfg.posts : [];
  const out = [];

  for (const p of posts) {
    if (!p?.roleId) continue;
    if (!member.roles?.cache?.has(p.roleId)) continue;

    const label = sanitizeValue(p.label || "POSTE");
    if (!label) continue;

    if (!out.includes(label)) out.push(label);
    if (out.length >= max) break;
  }

  return out; // 0..max
}

function buildLine(member, cfg, pseudos) {
  const pseudoPart = pickPseudoDisplay(member, pseudos);
  const rolePart = pickRoleLabel(member, cfg); // peut être ""
  const postParts = pickPostLabels(member, cfg, 3); // peut être []

  // IMPORTANT: si rôle pas renseigné => vide (mais on garde les séparateurs)
  // Exemple: "psn:abc |  | MDC/BU"
  const postsJoined = postParts.length ? postParts.join("/") : "";

  return `${pseudoPart} | ${rolePart} | ${postsJoined}`.trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription("Pseudos + format (psn:/xbox:/ea: | Rôle | Postes)")
    .addSubcommand((s) => s.setName("show").setDescription("Afficher ta ligne formatée."))
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Enregistrer un ID (oblige psn:/xbox:/ea:)")
        .addStringOption((o) =>
          o
            .setName("id")
            .setDescription("Ex: psn:MonID / xbox:MonID / ea:MonID")
            .setRequired(true)
        )
    )
    .addSubcommand((s) => s.setName("apply").setDescription("Appliquer le nickname formaté (staff).")),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) return interaction.reply({ content: "⛔", ephemeral: true });

      const cfg = getGuildConfig(interaction.guildId) || {};
      const member = interaction.member;
      const sub = interaction.options.getSubcommand();

      // ---- /pseudo set ----
      if (sub === "set") {
        const staff = isStaff(member, cfg);

        // règle: soit tu es staff/admin, soit tu es dans le salon pseudoScanChannelId (si défini)
        if (!staff && !inPseudoScanChannel(interaction, cfg)) {
          return interaction.reply({ content: "⛔", ephemeral: true });
        }

        const raw = interaction.options.getString("id", true);
        const parsed = parsePrefixedId(raw);

        if (!parsed) {
          // oblige un préfixe strict
          return interaction.reply({ content: "⚠️", ephemeral: true });
        }

        const patch = {};
        patch[parsed.platform] = parsed.value;

        setUserPseudos(interaction.guildId, interaction.user.id, patch);
        return interaction.reply({ content: "✅", ephemeral: true });
      }

      // Récup pseudo enregistré (si store le permet)
      let pseudos = null;
      try {
        pseudos = typeof getUserPseudos === "function" ? getUserPseudos(interaction.guildId, interaction.user.id) : null;
      } catch {
        pseudos = null;
      }

      // ---- /pseudo apply ----
      if (sub === "apply") {
        if (!isStaff(member, cfg)) return interaction.reply({ content: "⛔", ephemeral: true });

        const line = buildLine(member, cfg, pseudos);

        try {
          await member.setNickname(line, "PSEUDO_APPLY");
          return interaction.reply({ content: "✅", ephemeral: true });
        } catch {
          return interaction.reply({ content: "⚠️", ephemeral: true });
        }
      }

      // ---- /pseudo show ----
      const line = buildLine(member, cfg, pseudos);
      return interaction.reply({ content: line, ephemeral: true });
    } catch {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "⚠️", ephemeral: true });
        } else {
          await interaction.followUp({ content: "⚠️", ephemeral: true });
        }
      } catch {}
    }
  },
};
