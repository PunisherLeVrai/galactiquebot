// src/commands/admin/setup.js
// Setup interactif 100 % emojis — mobile friendly — CommonJS

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
} = require("discord.js");

const { getGuildConfig, upsertGuildConfig } = require("../../core/guildConfig");
const { log, warn } = require("../../core/logger");

const FLAGS_EPHEMERAL = 64;

// Emojis utilisés
const EMO = {
  commands: "⌨️",
  dispos: "📅",
  planning: "🗓️",
  annonces: "📢",
  staff: "🛡️",
  player: "👟",
  trial: "🧪",
  save: "💾",
  reset: "🔄",
  cancel: "❎",
};

function fmt(id) {
  return id ? `\`${id}\`` : "`—`";
}
function fmtCh(id) {
  return id ? `<#${id}>` : "—";
}
function fmtRole(id) {
  return id ? `<@&${id}>` : "—";
}

function embedSummary(guild, draft, saved) {
  return new EmbedBuilder()
    .setTitle("⚙️ Configuration du serveur")
    .setDescription("Sélectionne via les menus. Les boutons sont en emojis.")
    .addFields(
      {
        name: "Serveur",
        value: `${guild.name}\nID: ${fmt(guild.id)}`,
      },
      {
        name: `${EMO.commands} Commandes`,
        value: `Draft: ${fmtCh(draft.commandsChannelId)}\nActuel: ${fmtCh(saved.commandsChannelId)}`,
        inline: true,
      },
      {
        name: `${EMO.dispos} Dispos`,
        value: `Draft: ${fmtCh(draft.disposChannelId)}\nActuel: ${fmtCh(saved.disposChannelId)}`,
        inline: true,
      },
      {
        name: `${EMO.planning} Planning`,
        value: `Draft: ${fmtCh(draft.planningChannelId)}\nActuel: ${fmtCh(saved.planningChannelId)}`,
        inline: true,
      },
      {
        name: `${EMO.annonces} Annonces`,
        value: `Draft: ${fmtCh(draft.annoncesChannelId)}\nActuel: ${fmtCh(saved.annoncesChannelId)}`,
        inline: true,
      },
      {
        name: `${EMO.staff} Staff`,
        value: `Draft: ${fmtRole(draft.staffRoleId)}\nActuel: ${fmtRole(saved.staffRoleId)}`,
        inline: true,
      },
      {
        name: `${EMO.player} Joueur`,
        value: `Draft: ${fmtRole(draft.playerRoleId)}\nActuel: ${fmtRole(saved.playerRoleId)}`,
        inline: true,
      },
      {
        name: `${EMO.trial} Essai`,
        value: `Draft: ${fmtRole(draft.trialRoleId)}\nActuel: ${fmtRole(saved.trialRoleId)}`,
        inline: true,
      }
    )
    .setFooter({ text: "XIG BLAUGRANA FC Staff — Setup" });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configurer le bot (salons + rôles).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "Utilisable uniquement dans un serveur.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const guild = interaction.guild;
    const guildId = guild.id;
    const member = interaction.member;

    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: "Tu dois être Administrateur.",
        flags: FLAGS_EPHEMERAL,
      });
    }

    const saved = getGuildConfig(guildId) || {};

    const draft = {
      commandsChannelId: saved.commandsChannelId || null,
      disposChannelId: saved.disposChannelId || null,
      planningChannelId: saved.planningChannelId || null,
      annoncesChannelId: saved.annoncesChannelId || null,
      staffRoleId: saved.staffRoleId || null,
      playerRoleId: saved.playerRoleId || null,
      trialRoleId: saved.trialRoleId || null,
    };

    const scope = `${guildId}:${interaction.user.id}`;
    const CID = {
      commands: `setup:commands:${scope}`,
      dispos: `setup:dispos:${scope}`,
      planning: `setup:planning:${scope}`,
      annonces: `setup:annonces:${scope}`,

      staff: `setup:staff:${scope}`,
      player: `setup:player:${scope}`,
      trial: `setup:trial:${scope}`,

      save: `setup:save:${scope}`,
      reset: `setup:reset:${scope}`,
      cancel: `setup:cancel:${scope}`,
    };

    const embed = embedSummary(guild, draft, saved);

    const rowChannels1 = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CID.commands)
        .setPlaceholder(`${EMO.commands} Salon commandes`)
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
    );

    const rowChannels2 = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CID.dispos)
        .setPlaceholder(`${EMO.dispos} Salon dispos`)
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
    );

    const rowChannels3 = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CID.planning)
        .setPlaceholder(`${EMO.planning} Salon planning`)
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
    );

    const rowChannels4 = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CID.annonces)
        .setPlaceholder(`${EMO.annonces} Salon annonces`)
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)
    );

    const rowRoles = [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.staff)
          .setPlaceholder(`${EMO.staff} Rôle Staff`)
          .setMinValues(0)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.player)
          .setPlaceholder(`${EMO.player} Rôle Joueur`)
          .setMinValues(0)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(CID.trial)
          .setPlaceholder(`${EMO.trial} Rôle Essai`)
          .setMinValues(0)
          .setMaxValues(1)
      ),
    ];

    const rowButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.save)
        .setLabel(EMO.save)     // 💾
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(CID.reset)
        .setLabel(EMO.reset)    // 🔄
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(CID.cancel)
        .setLabel(EMO.cancel)   // ❎
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [embed],
      components: [rowChannels1, rowChannels2, rowChannels3, rowChannels4, rowButtons],
      flags: FLAGS_EPHEMERAL,
    });

    const rolesMsg = await interaction.followUp({
      content: "Sélection des rôles :",
      components: rowRoles,
      flags: FLAGS_EPHEMERAL,
    });

    const mainMsg = await interaction.fetchReply();
    const isOwner = (id) => id.endsWith(scope);

    const refresh = async () => {
      const e = embedSummary(guild, draft, saved);
      await interaction.editReply({
        embeds: [e],
        components: [rowChannels1, rowChannels2, rowChannels3, rowChannels4, rowButtons],
      });
    };

    const collectorMain = mainMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 10 * 60 * 1000,
    });

    // LISTENERS
    mainMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 })
      .on("collect", async (i) => {
        if (i.user.id !== interaction.user.id || !isOwner(i.customId)) {
          return i.reply({ content: "Pas pour toi.", flags: FLAGS_EPHEMERAL });
        }

        if (i.isChannelSelectMenu()) {
          const v = i.values?.[0] || null;
          if (i.customId === CID.commands) draft.commandsChannelId = v;
          if (i.customId === CID.dispos) draft.disposChannelId = v;
          if (i.customId === CID.planning) draft.planningChannelId = v;
          if (i.customId === CID.annonces) draft.annoncesChannelId = v;

          await i.deferUpdate();
          await refresh();
          return;
        }

        if (i.isButton()) {
          if (i.customId === CID.reset) {
            Object.keys(draft).forEach((k) => (draft[k] = null));
            await i.deferUpdate();
            await refresh();
            return;
          }

          if (i.customId === CID.cancel) {
            return i.update({
              content: "Setup annulé.",
              embeds: [],
              components: [],
            });
          }

          if (i.customId === CID.save) {
            const data = {
              commandsChannelId: draft.commandsChannelId,
              disposChannelId: draft.disposChannelId,
              planningChannelId: draft.planningChannelId,
              annoncesChannelId: draft.annoncesChannelId,
              staffRoleId: draft.staffRoleId,
              playerRoleId: draft.playerRoleId,
              trialRoleId: draft.trialRoleId,
              setupBy: interaction.user.id,
              setupAt: new Date().toISOString(),
            };

            const savedNow = upsertGuildConfig(guildId, data);
            Object.assign(saved, savedNow);

            await i.update({
              content: "💾 Configuration enregistrée.",
              embeds: [embedSummary(guild, draft, saved)],
              components: [],
            });

            await rolesMsg.edit({ content: "Configuration enregistrée.", components: [] });
            return;
          }
        }
      });

    rolesMsg.createMessageComponentCollector({ time: 10 * 60 * 1000 })
      .on("collect", async (i) => {
        if (i.user.id !== interaction.user.id || !isOwner(i.customId)) {
          return i.reply({ content: "Pas pour toi.", flags: FLAGS_EPHEMERAL });
        }

        if (i.isRoleSelectMenu()) {
          const v = i.values?.[0] || null;
          if (i.customId === CID.staff) draft.staffRoleId = v;
          if (i.customId === CID.player) draft.playerRoleId = v;
          if (i.customId === CID.trial) draft.trialRoleId = v;

          await i.deferUpdate();
          await refresh();
        }
      });

    log(`[SETUP] lancé par ${interaction.user.tag} sur ${guild.name} (${guildId})`);
  },
};
