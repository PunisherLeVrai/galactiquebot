const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(process.cwd(), "config", "servers.json");

function readServers() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeServers(obj) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), "utf8");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Initialise / met à jour la config du serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName("staff_role_id").setDescription("ID du rôle staff").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("log_channel_id").setDescription("ID du salon logs").setRequired(true)
    ),
  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({ content: "Commande utilisable uniquement sur un serveur.", ephemeral: true });
    }

    const staffRoleId = interaction.options.getString("staff_role_id", true);
    const logChannelId = interaction.options.getString("log_channel_id", true);

    const servers = readServers();
    servers[guildId] = {
      guildId,
      staffRoleId,
      logChannelId,
      updatedAt: new Date().toISOString(),
    };

    writeServers(servers);

    await interaction.reply({
      content:
        "Configuration enregistrée.\n" +
        `• staffRoleId: \`${staffRoleId}\`\n` +
        `• logChannelId: \`${logChannelId}\``,
      ephemeral: true,
    });
  },
};
