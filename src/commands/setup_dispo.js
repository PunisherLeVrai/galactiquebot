// src/commands/setup_dispo.js
// PRIME — Gestion des systèmes de disponibilités multiples
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const {
  getGuildConfig,
  upsertGuildConfig,
  normalizeDisponibilite,
} = require("../core/guildConfig");

function cleanSystemId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 32);
}

function parseIds(value, max = 25) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function parseMessageIds(value) {
  const values = parseIds(value, 7);

  while (values.length < 7) {
    values.push(null);
  }

  return values.slice(0, 7);
}

function parseTimes(value) {
  const output = [];

  for (const raw of String(value || "").split(",")) {
    const time = raw.trim();

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      continue;
    }

    if (!output.includes(time)) {
      output.push(time);
    }
  }

  return output.sort((a, b) => a.localeCompare(b));
}

function isStaff(member, config) {
  if (!member) return false;

  if (
    member.permissions?.has?.(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  const staffRoleIds =
    Array.isArray(config?.staffRoleIds)
      ? config.staffRoleIds
      : [];

  return staffRoleIds.some(
    (roleId) =>
      roleId &&
      member.roles?.cache?.has?.(
        String(roleId)
      )
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup_dispo")
    .setDescription("PRIME : gérer plusieurs systèmes de disponibilités.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ajouter")
        .setDescription("Créer ou modifier un système de disponibilités.")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Identifiant court : equipe1, equipe2...")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("nom")
            .setDescription("Nom affiché du système")
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("salon_dispos")
            .setDescription("Salon contenant les disponibilités")
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("salon_rapports")
            .setDescription("Salon recevant les rapports staff")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("roles_joueurs")
            .setDescription("IDs des rôles joueurs séparés par des virgules")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("messages")
            .setDescription("7 IDs Lun→Dim séparés par des virgules")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("check")
            .setDescription("Horaires CheckDispo : 15:00,17:00")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("rappel")
            .setDescription("Horaires rappels : 12:00,16:00")
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName("avertissement")
            .setDescription("Activer les avertissements")
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName("roles_avertissement")
            .setDescription("IDs avertissement 1, 2 et 3 séparés par virgules")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("supprimer")
        .setDescription("Supprimer un système de disponibilités.")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Identifiant du système")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("liste")
        .setDescription("Afficher les systèmes configurés.")
    )
    .setDefaultMemberPermissions(0n),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "⛔ Cette commande doit être utilisée dans un serveur.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const config =
        getGuildConfig(interaction.guildId) || {};

      if (!isStaff(interaction.member, config)) {
        return interaction.reply({
          content: "⛔ Accès réservé au STAFF.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const subcommand =
        interaction.options.getSubcommand();

      const current =
        Array.isArray(config.disponibilites)
          ? [...config.disponibilites]
          : [];

      if (subcommand === "liste") {
        const lines = current.map(
          (system) =>
            `• **${system.nom}** — \`${system.id}\` — <#${system.disposChannelId}> — ${system.playerRoleIds.length} rôle(s) joueur(s)`
        );

        return interaction.reply({
          content:
            `**PRIME — Systèmes de disponibilités**\n\n` +
            (lines.length
              ? lines.join("\n")
              : "Aucun système configuré."),
          flags: MessageFlags.Ephemeral,
        });
      }

      const id = cleanSystemId(
        interaction.options.getString("id")
      );

      if (!id) {
        return interaction.reply({
          content: "❌ Identifiant invalide.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === "supprimer") {
        const next = current.filter(
          (system) => system.id !== id
        );

        if (next.length === current.length) {
          return interaction.reply({
            content: `❌ Aucun système trouvé avec l'ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        upsertGuildConfig(
          interaction.guildId,
          {
            disponibilites: next,
          }
        );

        return interaction.reply({
          content: `✅ Système \`${id}\` supprimé.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const previous =
        current.find(
          (system) => system.id === id
        ) || {};

      const messagesRaw =
        interaction.options.getString("messages");

      const checkRaw =
        interaction.options.getString("check");

      const rappelRaw =
        interaction.options.getString("rappel");

      const warningRaw =
        interaction.options.getString(
          "roles_avertissement"
        );

      const warningEnabled =
        interaction.options.getBoolean(
          "avertissement"
        );

      const warningRoleIds =
        warningRaw !== null
          ? parseIds(warningRaw, 3)
          : previous.automations?.avertissement?.roleIds || [];

      while (warningRoleIds.length < 3) {
        warningRoleIds.push(null);
      }

      const system = normalizeDisponibilite({
        ...previous,
        id,
        nom: interaction.options.getString("nom"),
        disposChannelId:
          interaction.options.getChannel("salon_dispos").id,
        checkDispoChannelId:
          interaction.options.getChannel("salon_dispos").id,
        reportChannelId:
          interaction.options.getChannel("salon_rapports").id,
        playerRoleIds: parseIds(
          interaction.options.getString("roles_joueurs")
        ),
        dispoMessageIds:
          messagesRaw !== null
            ? parseMessageIds(messagesRaw)
            : previous.dispoMessageIds,
        automations: {
          checkDispo: {
            enabled:
              checkRaw !== null
                ? parseTimes(checkRaw).length > 0
                : previous.automations?.checkDispo?.enabled || false,
            times:
              checkRaw !== null
                ? parseTimes(checkRaw)
                : previous.automations?.checkDispo?.times || [],
          },
          rappel: {
            enabled:
              rappelRaw !== null
                ? parseTimes(rappelRaw).length > 0
                : previous.automations?.rappel?.enabled || false,
            times:
              rappelRaw !== null
                ? parseTimes(rappelRaw)
                : previous.automations?.rappel?.times || [],
          },
          avertissement: {
            ...previous.automations?.avertissement,
            enabled:
              warningEnabled !== null
                ? warningEnabled
                : previous.automations?.avertissement?.enabled || false,
            roleIds: warningRoleIds,
            roleId: warningRoleIds[0] || null,
          },
        },
      });

      const next = current.filter(
        (item) => item.id !== id
      );

      next.push(system);

      upsertGuildConfig(
        interaction.guildId,
        {
          disponibilites: next,
        }
      );

      return interaction.reply({
        content:
          `✅ Système **${system.nom}** sauvegardé.\n` +
          `ID à utiliser dans les commandes : \`${system.id}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error(
        "[PRIME][SETUP_DISPO]",
        error
      );

      const payload = {
        content: "⚠️ Erreur pendant la configuration des disponibilités.",
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        return interaction
          .followUp(payload)
          .catch(() => {});
      }

      return interaction
        .reply(payload)
        .catch(() => {});
    }
  },
};
