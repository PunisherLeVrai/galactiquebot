// src/commands/pseudo.js
// Mise à jour ou affichage du pseudo joueur
// Support: psn / xbox / ea / auto-scan
// Format final: "PSEUDO | RÔLE | POSTE1/POSTE2/POSTE3"
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

const { getGuildConfig } = require("../core/guildConfig");
const { setUserPseudos, getUserPseudos } = require("../core/pseudoStore");
const { buildMemberLine } = require("../core/memberDisplay");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription("Définir ou afficher le pseudo PSN/XBOX/EA.")
    .addStringOption(opt =>
      opt
        .setName("psn")
        .setDescription("ID PSN (optionnel)")
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName("xbox")
        .setDescription("ID XBOX (optionnel)")
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName("ea")
        .setDescription("ID EA (optionnel)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: "⛔", ephemeral: true });
      }

      const guild = interaction.guild;
      const guildId = guild.id;
      const cfg = getGuildConfig(guildId) || {};

      // ---------------------------------------------------------
      // 1) Lecture des options fournies
      // ---------------------------------------------------------
      const psn = interaction.options.getString("psn") || "";
      const xbox = interaction.options.getString("xbox") || "";
      const ea = interaction.options.getString("ea") || "";

      let mode = null;
      if (psn) mode = "psn";
      if (xbox) mode = "xbox";
      if (ea) mode = "ea";

      // ---------------------------------------------------------
      // 2) Si aucun ID fourni, essayer auto SCAN du message dans le salon pseudoScan
      // ---------------------------------------------------------
      let autoExtract = { psn: "", xbox: "", ea: "" };

      const scanChannelId = cfg.pseudoScanChannelId;
      if (!mode && scanChannelId && interaction.channelId === scanChannelId) {
        const txt = interaction?.options?._hoistedOptions?.[0]?.value || "";
        const content = (txt || "").toString();

        const mPsn = content.match(/psn[:= ]+([a-z0-9_\-]+)/i);
        const mXbox = content.match(/xbox[:= ]+([a-z0-9_\-]+)/i);
        const mEa = content.match(/ea[:= ]+([a-z0-9_\-]+)/i);

        if (mPsn) autoExtract.psn = mPsn[1];
        if (mXbox) autoExtract.xbox = mXbox[1];
        if (mEa) autoExtract.ea = mEa[1];

        if (autoExtract.psn || autoExtract.xbox || autoExtract.ea) {
          mode = "auto";
        }
      }

      // ---------------------------------------------------------
      // 3) Stockage si mode défini
      // ---------------------------------------------------------
      if (mode) {
        const patch = {
          psn: psn || autoExtract.psn || undefined,
          xbox: xbox || autoExtract.xbox || undefined,
          ea: ea || autoExtract.ea || undefined,
        };

        const stored = setUserPseudos(guildId, interaction.user.id, patch);

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Pseudo mis à jour")
          .setDescription(
            [
              stored.psn ? `PSN: **${stored.psn}**` : null,
              stored.xbox ? `XBOX: **${stored.xbox}**` : null,
              stored.ea ? `EA: **${stored.ea}**` : null,
            ]
              .filter(Boolean)
              .join("\n")
          )
          .setFooter({ text: cfg.botLabel || "XIG FC" });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // ---------------------------------------------------------
      // 4) Aucun pseudo fourni → juste afficher format complet
      // ---------------------------------------------------------
      const member = await guild.members.fetch(interaction.user.id);
      const line = buildMemberLine(member, cfg);

      const display = getUserPseudos(guildId, interaction.user.id) || {};

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Pseudo actuel")
        .addFields(
          {
            name: "Données",
            value:
              [
                display.psn ? `PSN: **${display.psn}**` : null,
                display.xbox ? `XBOX: **${display.xbox}**` : null,
                display.ea ? `EA: **${display.ea}**` : null,
              ]
                .filter(Boolean)
                .join("\n") || "Aucun pseudo enregistré.",
          },
          {
            name: "Format /pseudo",
            value: `\`${line}\``,
          }
        )
        .setFooter({ text: cfg.botLabel || "XIG FC" });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error("[/pseudo ERROR]", err);
      try {
        return interaction.reply({ content: "⚠️", ephemeral: true });
      } catch {}
    }
  },
};
