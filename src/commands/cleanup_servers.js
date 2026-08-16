// src/commands/cleanup_servers.js
// PROSYNC — nettoyage des données des serveurs quittés
//
// Compare :
// - les serveurs actuellement accessibles par le bot
// - les guilds enregistrées dans servers.json
// - les guilds enregistrées dans pseudos.json
//
// Modes :
// - scan  : affiche ce qui serait supprimé
// - clean : supprime réellement les données orphelines
//
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const {
  exportAllConfig,
  resetGuildConfig,
} = require("../core/guildConfig");

const {
  exportAllPseudos,
  resetGuildPseudos,
} = require("../core/pseudoStore");

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function uniq(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function formatGuildList(ids, knownGuilds, max = 25) {
  const values = uniq(ids);

  if (!values.length) {
    return "—";
  }

  const lines = values.slice(0, max).map((guildId) => {
    const guild = knownGuilds.get(guildId);

    if (guild) {
      return `• **${guild.name}** — \`${guildId}\``;
    }

    return `• Serveur inconnu/quitté — \`${guildId}\``;
  });

  if (values.length > max) {
    lines.push(`… +${values.length - max} autre(s)`);
  }

  return lines.join("\n");
}

// --------------------------------------------------
// Commande
// --------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cleanup_servers")
    .setDescription(
      "PROSYNC : nettoyer les données des serveurs où le bot n'est plus présent."
    )
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Choisir entre analyse et suppression.")
        .setRequired(true)
        .addChoices(
          {
            name: "Scan uniquement",
            value: "scan",
          },
          {
            name: "Nettoyer",
            value: "clean",
          }
        )
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content:
            "⛔ Cette commande doit être utilisée depuis un serveur Discord.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Sécurité supplémentaire
      if (
        !interaction.member?.permissions?.has?.(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content:
            "⛔ Cette commande est réservée aux administrateurs.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const mode =
        interaction.options.getString("mode", true);

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      });

      const client = interaction.client;

      // --------------------------------------------------
      // 1. Serveurs actuellement connus par Discord.js
      // --------------------------------------------------

      const activeGuilds = new Map();

      for (const guild of client.guilds.cache.values()) {
        activeGuilds.set(String(guild.id), guild);
      }

      const activeGuildIds = new Set(
        Array.from(activeGuilds.keys())
      );

      // --------------------------------------------------
      // 2. Lecture servers.json
      // --------------------------------------------------

      const configData =
        exportAllConfig() || {
          guilds: {},
        };

      const configGuildIds = Object.keys(
        configData.guilds || {}
      ).map(String);

      // --------------------------------------------------
      // 3. Lecture pseudos.json
      // --------------------------------------------------

      const pseudoData =
        exportAllPseudos() || {
          guilds: {},
        };

      const pseudoGuildIds = Object.keys(
        pseudoData.guilds || {}
      ).map(String);

      // --------------------------------------------------
      // 4. Recherche des guilds orphelines
      // --------------------------------------------------

      const orphanConfigIds =
        configGuildIds.filter(
          (guildId) =>
            !activeGuildIds.has(guildId)
        );

      const orphanPseudoIds =
        pseudoGuildIds.filter(
          (guildId) =>
            !activeGuildIds.has(guildId)
        );

      const allOrphanIds = uniq([
        ...orphanConfigIds,
        ...orphanPseudoIds,
      ]);

      // --------------------------------------------------
      // 5. Aucun nettoyage nécessaire
      // --------------------------------------------------

      if (!allOrphanIds.length) {
        const embed = new EmbedBuilder()
          .setTitle("🧹 PROSYNC — Nettoyage serveurs")
          .setColor(0x57f287)
          .setDescription(
            "✅ Aucune donnée orpheline détectée."
          )
          .addFields(
            {
              name: "Serveurs actifs",
              value: `**${activeGuildIds.size}**`,
              inline: true,
            },
            {
              name: "servers.json",
              value: `**${configGuildIds.length}** serveur(s)`,
              inline: true,
            },
            {
              name: "pseudos.json",
              value: `**${pseudoGuildIds.length}** serveur(s)`,
              inline: true,
            }
          )
          .setFooter({
            text: "PROSYNC",
          })
          .setTimestamp();

        return interaction.editReply({
          embeds: [embed],
        });
      }

      // --------------------------------------------------
      // 6. Mode SCAN
      // --------------------------------------------------

      if (mode === "scan") {
        const embed = new EmbedBuilder()
          .setTitle("🔍 PROSYNC — Scan serveurs")
          .setColor(0xfee75c)
          .setDescription(
            [
              `Serveurs actuellement accessibles par PROSYNC : **${activeGuildIds.size}**`,
              "",
              `Données orphelines détectées : **${allOrphanIds.length} serveur(s)**`,
              "",
              "⚠️ Aucune donnée n'a été supprimée.",
            ].join("\n")
          )
          .addFields(
            {
              name:
                `⚙️ servers.json — ${orphanConfigIds.length} à supprimer`,
              value: formatGuildList(
                orphanConfigIds,
                activeGuilds
              ),
            },
            {
              name:
                `👤 pseudos.json — ${orphanPseudoIds.length} à supprimer`,
              value: formatGuildList(
                orphanPseudoIds,
                activeGuilds
              ),
            }
          )
          .setFooter({
            text:
              "PROSYNC — utilise /cleanup_servers mode:Nettoyer pour confirmer",
          })
          .setTimestamp();

        return interaction.editReply({
          embeds: [embed],
        });
      }

      // --------------------------------------------------
      // 7. Mode CLEAN
      // --------------------------------------------------

      let configRemoved = 0;
      let pseudoRemoved = 0;

      const configFailed = [];
      const pseudoFailed = [];

      // Nettoyage servers.json
      for (const guildId of orphanConfigIds) {
        try {
          const result =
            resetGuildConfig(guildId);

          if (result) {
            configRemoved++;
          } else {
            configFailed.push(guildId);
          }
        } catch (error) {
          console.error(
            `[PROSYNC][CLEANUP][CONFIG] ${guildId}`,
            error
          );

          configFailed.push(guildId);
        }
      }

      // Nettoyage pseudos.json
      for (const guildId of orphanPseudoIds) {
        try {
          const result =
            resetGuildPseudos(guildId);

          if (result) {
            pseudoRemoved++;
          } else {
            pseudoFailed.push(guildId);
          }
        } catch (error) {
          console.error(
            `[PROSYNC][CLEANUP][PSEUDOS] ${guildId}`,
            error
          );

          pseudoFailed.push(guildId);
        }
      }

      // --------------------------------------------------
      // 8. Rapport final
      // --------------------------------------------------

      const totalFailures =
        configFailed.length +
        pseudoFailed.length;

      const embed = new EmbedBuilder()
        .setTitle("🧹 PROSYNC — Nettoyage terminé")
        .setColor(
          totalFailures > 0
            ? 0xfee75c
            : 0x57f287
        )
        .setDescription(
          totalFailures > 0
            ? "⚠️ Nettoyage terminé avec certains échecs."
            : "✅ Toutes les données orphelines détectées ont été nettoyées."
        )
        .addFields(
          {
            name: "Serveurs actifs",
            value: `**${activeGuildIds.size}**`,
            inline: true,
          },
          {
            name: "Configurations supprimées",
            value: `**${configRemoved}**`,
            inline: true,
          },
          {
            name: "Stocks pseudos supprimés",
            value: `**${pseudoRemoved}**`,
            inline: true,
          },
          {
            name: "IDs nettoyés",
            value: formatGuildList(
              allOrphanIds,
              activeGuilds
            ),
          }
        )
        .setFooter({
          text: "PROSYNC",
        })
        .setTimestamp();

      if (configFailed.length) {
        embed.addFields({
          name:
            "⚠️ Échecs servers.json",
          value: configFailed
            .map(
              (guildId) =>
                `\`${guildId}\``
            )
            .join("\n")
            .slice(0, 1024),
        });
      }

      if (pseudoFailed.length) {
        embed.addFields({
          name:
            "⚠️ Échecs pseudos.json",
          value: pseudoFailed
            .map(
              (guildId) =>
                `\`${guildId}\``
            )
            .join("\n")
            .slice(0, 1024),
        });
      }

      console.log(
        `[PROSYNC][CLEANUP] Config=${configRemoved}, Pseudos=${pseudoRemoved}, Erreurs=${totalFailures}`
      );

      return interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error(
        "[PROSYNC][CLEANUP_SERVERS]",
        error
      );

      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content:
              "⚠️ Erreur pendant le nettoyage des serveurs.",
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content:
              "⚠️ Erreur pendant le nettoyage des serveurs.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {}
    }
  },
};
