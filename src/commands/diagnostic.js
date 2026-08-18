// src/commands/diagnostic.js
// PROSYNC — Diagnostic complet du serveur
//
// Vérifie :
// - configuration générale
// - salons
// - rôles
// - hiérarchie du bot
// - système pseudo
// - messages de disponibilité
// - automations
// - rôles avertissement
//
// Lecture seule : aucune donnée n'est modifiée.
//
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const {
  getGuildConfig,
} = require("../core/guildConfig");

// --------------------------------------------------
// Constantes
// --------------------------------------------------

const DAYS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

const STATUS = {
  ok: "✅",
  warning: "⚠️",
  error: "❌",
  info: "ℹ️",
};

// --------------------------------------------------
// Helpers
// --------------------------------------------------

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

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function cleanIds(values) {
  return safeArray(values)
    .map((value) =>
      String(value || "").trim()
    )
    .filter(Boolean);
}

function formatChannel(channel) {
  if (!channel) return "Introuvable";

  return `<#${channel.id}>`;
}

function formatRole(role) {
  if (!role) return "Introuvable";

  return `<@&${role.id}>`;
}

function formatTimes(times) {
  const values = safeArray(times);

  if (!values.length) {
    return "Aucun";
  }

  return values
    .map((time) => `\`${time}\``)
    .join(" ");
}

function getWarningRoleIds(config) {
  const warning =
    config?.automations?.avertissement ||
    {};

  if (
    Array.isArray(warning.roleIds)
  ) {
    return warning.roleIds
      .slice(0, 3)
      .map((id) =>
        id ? String(id) : null
      );
  }

  return [
    warning.roleId
      ? String(warning.roleId)
      : null,
    null,
    null,
  ];
}

function addCheck(
  checks,
  level,
  label,
  detail
) {
  checks.push({
    level,
    label,
    detail,
  });
}

function checkLine(check) {
  return `${STATUS[check.level]} **${check.label}**\n${check.detail}`;
}

function countChecks(checks) {
  return {
    ok: checks.filter(
      (item) => item.level === "ok"
    ).length,

    warning: checks.filter(
      (item) =>
        item.level === "warning"
    ).length,

    error: checks.filter(
      (item) => item.level === "error"
    ).length,

    info: checks.filter(
      (item) => item.level === "info"
    ).length,
  };
}

function getStatusColor(counts) {
  if (counts.error > 0) {
    return 0xed4245;
  }

  if (counts.warning > 0) {
    return 0xfee75c;
  }

  return 0x57f287;
}

// --------------------------------------------------
// Vérification salon
// --------------------------------------------------

async function inspectChannel(
  guild,
  channelId,
  {
    label,
    required = false,
    permissions = [],
  }
) {
  if (!channelId) {
    return {
      level: required
        ? "error"
        : "warning",

      label,

      detail: required
        ? "Aucun salon configuré."
        : "Aucun salon configuré.",
    };
  }

  const channel =
    await guild.channels
      .fetch(String(channelId))
      .catch(() => null);

  if (!channel) {
    return {
      level: "error",
      label,
      detail:
        `Salon configuré mais introuvable : \`${channelId}\`.`,
    };
  }

  if (!channel.isTextBased?.()) {
    return {
      level: "error",
      label,
      detail:
        `${formatChannel(channel)} n'est pas un salon texte compatible.`,
    };
  }

  const botMember =
    guild.members.me;

  if (!botMember) {
    return {
      level: "error",
      label,
      detail:
        "Impossible de récupérer le membre Discord du bot.",
    };
  }

  const channelPermissions =
    channel.permissionsFor(
      botMember
    );

  const missingPermissions =
    permissions.filter(
      ({ permission }) =>
        !channelPermissions?.has(
          permission
        )
    );

  if (missingPermissions.length) {
    return {
      level: "error",
      label,
      detail:
        `${formatChannel(channel)}\n` +
        `Permissions manquantes : **${missingPermissions
          .map(
            ({ label: permissionLabel }) =>
              permissionLabel
          )
          .join(", ")}**`,
    };
  }

  return {
    level: "ok",
    label,
    detail: formatChannel(channel),
  };
}

// --------------------------------------------------
// Vérification rôle
// --------------------------------------------------

async function inspectRole(
  guild,
  roleId,
  {
    label,
    required = false,
    mustBeEditable = false,
  }
) {
  if (!roleId) {
    return {
      level: required
        ? "error"
        : "warning",

      label,

      detail: "Aucun rôle configuré.",
    };
  }

  const role =
    await guild.roles
      .fetch(String(roleId))
      .catch(() => null);

  if (!role) {
    return {
      level: "error",
      label,
      detail:
        `Rôle introuvable : \`${roleId}\`.`,
    };
  }

  if (
    mustBeEditable &&
    !role.editable
  ) {
    return {
      level: "error",
      label,
      detail:
        `${formatRole(role)} — PROSYNC ne peut pas gérer ce rôle.\n` +
        "Place le rôle du bot au-dessus de ce rôle dans la hiérarchie Discord.",
    };
  }

  return {
    level: "ok",
    label,
    detail: formatRole(role),
  };
}

// --------------------------------------------------
// Vérification IDs messages disponibilité
// --------------------------------------------------

async function inspectDispoMessages(
  guild,
  config
) {
  const results = [];

  const channelId =
    config?.checkDispoChannelId ||
    config?.disposChannelId;

  if (!channelId) {
    return {
      level: "error",
      label:
        "Messages de disponibilité",
      detail:
        "Impossible de vérifier les IDs : aucun salon CheckDispo / Dispos configuré.",
    };
  }

  const channel =
    await guild.channels
      .fetch(String(channelId))
      .catch(() => null);

  if (
    !channel ||
    !channel.isTextBased?.()
  ) {
    return {
      level: "error",
      label:
        "Messages de disponibilité",
      detail:
        "Le salon contenant les messages de disponibilité est introuvable.",
    };
  }

  const ids =
    safeArray(
      config?.dispoMessageIds
    );

  let valid = 0;
  let missing = 0;
  let notConfigured = 0;

  for (
    let index = 0;
    index < 7;
    index++
  ) {
    const messageId =
      ids[index]
        ? String(ids[index])
        : null;

    if (!messageId) {
      notConfigured++;

      results.push(
        `${STATUS.warning} ${DAYS[index]} : aucun ID`
      );

      continue;
    }

    const message =
      await channel.messages
        .fetch(messageId)
        .catch(() => null);

    if (!message) {
      missing++;

      results.push(
        `${STATUS.error} ${DAYS[index]} : \`${messageId}\` introuvable`
      );

      continue;
    }

    valid++;

    results.push(
      `${STATUS.ok} ${DAYS[index]} : message trouvé`
    );
  }

  let level = "ok";

  if (missing > 0) {
    level = "error";
  } else if (
    notConfigured > 0
  ) {
    level = "warning";
  }

  return {
    level,
    label:
      "Messages de disponibilité",

    detail:
      `Valides : **${valid}/7**\n` +
      `Non configurés : **${notConfigured}**\n` +
      `Introuvables : **${missing}**\n\n` +
      results.join("\n"),
  };
}

// --------------------------------------------------
// Diagnostic
// --------------------------------------------------

module.exports = {
  data:
    new SlashCommandBuilder()
      .setName("diagnostic")
      .setDescription(
        "PROSYNC : vérifier la configuration et détecter les problèmes."
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.Administrator
      ),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content:
            "⛔ Cette commande doit être utilisée dans un serveur.",
          flags:
            MessageFlags.Ephemeral,
        });
      }

      const guild =
        interaction.guild;

      const config =
        getGuildConfig(
          interaction.guildId
        );

      if (!config) {
        return interaction.reply({
          content:
            "❌ Aucune configuration PROSYNC trouvée pour ce serveur. Lance `/setup`.",
          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        !isStaff(
          interaction.member,
          config
        )
      ) {
        return interaction.reply({
          content:
            "⛔ Accès réservé au STAFF.",
          flags:
            MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({
        flags:
          MessageFlags.Ephemeral,
      });

      await guild.members
        .fetch()
        .catch(() => null);

      await guild.roles
        .fetch()
        .catch(() => null);

      const botMember =
        guild.members.me;

      const checks = [];

      // ==================================================
      // BOT
      // ==================================================

      if (!botMember) {
        addCheck(
          checks,
          "error",
          "Bot Discord",
          "Impossible de récupérer PROSYNC comme membre du serveur."
        );
      } else {
        addCheck(
          checks,
          "ok",
          "Bot Discord",
          `Connecté sous **${botMember.user.tag}**.`
        );
      }

      // ==================================================
      // PERMISSIONS GLOBALES
      // ==================================================

      if (botMember) {
        const requiredGlobal = [
          {
            permission:
              PermissionFlagsBits.ManageNicknames,
            label:
              "Gérer les pseudos",
          },
          {
            permission:
              PermissionFlagsBits.ManageRoles,
            label:
              "Gérer les rôles",
          },
          {
            permission:
              PermissionFlagsBits.ViewChannel,
            label:
              "Voir les salons",
          },
          {
            permission:
              PermissionFlagsBits.SendMessages,
            label:
              "Envoyer des messages",
          },
          {
            permission:
              PermissionFlagsBits.ReadMessageHistory,
            label:
              "Voir l'historique",
          },
          {
            permission:
              PermissionFlagsBits.AddReactions,
            label:
              "Ajouter des réactions",
          },
          {
            permission:
              PermissionFlagsBits.EmbedLinks,
            label:
              "Intégrer des liens / embeds",
          },
        ];

        const missingGlobal =
          requiredGlobal.filter(
            ({ permission }) =>
              !botMember.permissions.has(
                permission
              )
          );

        if (
          missingGlobal.length
        ) {
          addCheck(
            checks,
            "error",
            "Permissions générales",
            `Permissions manquantes : **${missingGlobal
              .map(
                (item) =>
                  item.label
              )
              .join(", ")}**`
          );
        } else {
          addCheck(
            checks,
            "ok",
            "Permissions générales",
            "Toutes les permissions principales nécessaires sont disponibles."
          );
        }
      }

      // ==================================================
      // SALONS
      // ==================================================

      const channelRequirements = [
        {
          permission:
            PermissionFlagsBits.ViewChannel,
          label: "Voir le salon",
        },
        {
          permission:
            PermissionFlagsBits.ReadMessageHistory,
          label:
            "Lire l'historique",
        },
      ];

      checks.push(
        await inspectChannel(
          guild,
          config.disposChannelId,
          {
            label:
              "Salon Disponibilités",
            required: true,
            permissions: [
              ...channelRequirements,
              {
                permission:
                  PermissionFlagsBits.SendMessages,
                label:
                  "Envoyer des messages",
              },
            ],
          }
        )
      );

      checks.push(
        await inspectChannel(
          guild,
          config.staffReportsChannelId,
          {
            label:
              "Salon Rapports Staff",
            required: true,
            permissions: [
              ...channelRequirements,
              {
                permission:
                  PermissionFlagsBits.SendMessages,
                label:
                  "Envoyer des messages",
              },
              {
                permission:
                  PermissionFlagsBits.EmbedLinks,
                label:
                  "Envoyer des embeds",
              },
            ],
          }
        )
      );

      checks.push(
        await inspectChannel(
          guild,
          config.pseudoScanChannelId,
          {
            label:
              "Salon Pseudos",
            required: true,
            permissions: [
              ...channelRequirements,
              {
                permission:
                  PermissionFlagsBits.AddReactions,
                label:
                  "Ajouter des réactions",
              },
            ],
          }
        )
      );

      checks.push(
        await inspectChannel(
          guild,
          config.checkDispoChannelId,
          {
            label:
              "Salon CheckDispo",
            required: false,
            permissions:
              channelRequirements,
          }
        )
      );

      // ==================================================
      // RÔLES STAFF
      // ==================================================

      const staffRoleIds =
        cleanIds(
          config.staffRoleIds
        );

      if (!staffRoleIds.length) {
        addCheck(
          checks,
          "error",
          "Rôles Staff",
          "Aucun rôle Staff configuré."
        );
      } else {
        const missingRoles = [];

        for (
          const roleId of staffRoleIds
        ) {
          const role =
            await guild.roles
              .fetch(roleId)
              .catch(() => null);

          if (!role) {
            missingRoles.push(
              roleId
            );
          }
        }

        if (
          missingRoles.length
        ) {
          addCheck(
            checks,
            "error",
            "Rôles Staff",
            `Rôle(s) introuvable(s) : ${missingRoles
              .map(
                (id) =>
                  `\`${id}\``
              )
              .join(" ")}`
          );
        } else {
          addCheck(
            checks,
            "ok",
            "Rôles Staff",
            `${staffRoleIds.length} rôle(s) valide(s).`
          );
        }
      }

      // ==================================================
      // RÔLES JOUEURS
      // ==================================================

      const playerRoleIds =
        cleanIds(
          config.playerRoleIds
        );

      if (!playerRoleIds.length) {
        addCheck(
          checks,
          "error",
          "Rôles Joueurs",
          "Aucun rôle Joueur configuré."
        );
      } else {
        const existing =
          playerRoleIds.filter(
            (id) =>
              guild.roles.cache.has(
                id
              )
          );

        if (
          existing.length !==
          playerRoleIds.length
        ) {
          addCheck(
            checks,
            "error",
            "Rôles Joueurs",
            `${existing.length}/${playerRoleIds.length} rôle(s) trouvé(s).`
          );
        } else {
          addCheck(
            checks,
            "ok",
            "Rôles Joueurs",
            `${existing.length} rôle(s) configuré(s).`
          );
        }
      }

      // ==================================================
      // POSTES
      // ==================================================

      const postRoleIds =
        cleanIds(
          config.postRoleIds
        );

      if (!postRoleIds.length) {
        addCheck(
          checks,
          "warning",
          "Rôles Postes",
          "Aucun poste configuré. Les nicknames fonctionneront sans poste."
        );
      } else {
        const existing =
          postRoleIds.filter(
            (id) =>
              guild.roles.cache.has(
                id
              )
          );

        if (
          existing.length !==
          postRoleIds.length
        ) {
          addCheck(
            checks,
            "warning",
            "Rôles Postes",
            `${existing.length}/${postRoleIds.length} rôle(s) encore présents sur Discord.`
          );
        } else {
          addCheck(
            checks,
            "ok",
            "Rôles Postes",
            `${existing.length} poste(s) configuré(s).`
          );
        }
      }

      // ==================================================
      // RÔLE AFFICHÉ DANS LE PSEUDO
      // ==================================================

      if (!config.displayRoleId) {
        addCheck(
          checks,
          "warning",
          "Rôle affiché dans le pseudo",
          "Aucun rôle joueur principal configuré. Le format peut devenir `POSTE / PSEUDO` pour les non-staff."
        );
      } else {
        const displayRole =
          await guild.roles
            .fetch(
              String(
                config.displayRoleId
              )
            )
            .catch(() => null);

        if (!displayRole) {
          addCheck(
            checks,
            "error",
            "Rôle affiché dans le pseudo",
            `Rôle introuvable : \`${config.displayRoleId}\`.`
          );
        } else {
          addCheck(
            checks,
            "ok",
            "Rôle affiché dans le pseudo",
            formatRole(
              displayRole
            )
          );
        }
      }

      // ==================================================
      // HIÉRARCHIE DU BOT
      // ==================================================

      if (botMember) {
        const botHighest =
          botMember.roles.highest;

        const rolesToManage = [
          ...getWarningRoleIds(
            config
          ).filter(Boolean),
        ];

        const problematic = [];

        for (
          const roleId of rolesToManage
        ) {
          const role =
            guild.roles.cache.get(
              String(roleId)
            );

          if (
            role &&
            botHighest.comparePositionTo(
              role
            ) <= 0
          ) {
            problematic.push(
              role
            );
          }
        }

        if (
          problematic.length
        ) {
          addCheck(
            checks,
            "error",
            "Hiérarchie des rôles",
            `Le rôle PROSYNC doit être placé au-dessus de :\n${problematic
              .map(
                (role) =>
                  `• ${formatRole(role)}`
              )
              .join("\n")}`
          );
        } else {
          addCheck(
            checks,
            "ok",
            "Hiérarchie des rôles",
            "Les rôles d'avertissement configurés sont sous le rôle du bot."
          );
        }
      }

      // ==================================================
      // PSEUDOS
      // ==================================================

      if (
        !config.pseudoScanChannelId
      ) {
        addCheck(
          checks,
          "error",
          "Système Pseudo",
          "Aucun salon pseudo configuré. Le fallback USERNAME fonctionnera lors des synchronisations, mais aucun pseudo personnalisé ne pourra être enregistré."
        );
      } else {
        addCheck(
          checks,
          "ok",
          "Système Pseudo",
          "Salon pseudo configuré. Priorité : **pseudo du salon → username Discord**."
        );
      }

      // ==================================================
      // MESSAGES DISPONIBILITÉ
      // ==================================================

      checks.push(
        await inspectDispoMessages(
          guild,
          config
        )
      );

      // ==================================================
      // AUTOMATION GLOBALE
      // ==================================================

      if (
        config.automations?.enabled
      ) {
        addCheck(
          checks,
          "ok",
          "Automation globale",
          "Activée."
        );
      } else {
        addCheck(
          checks,
          "warning",
          "Automation globale",
          "Désactivée. Les automations planifiées ne s'exécuteront pas."
        );
      }

      // ==================================================
      // AUTOMATION PSEUDO
      // ==================================================

      const pseudoAutomation =
        config.automations?.pseudo ||
        {};

      if (
        pseudoAutomation.enabled
      ) {
        addCheck(
          checks,
          "ok",
          "Automation Pseudo",
          `Activée à la minute **${pseudoAutomation.minute ?? 10}** de chaque heure.`
        );
      } else {
        addCheck(
          checks,
          "warning",
          "Automation Pseudo",
          "Synchronisation périodique désactivée."
        );
      }

      // ==================================================
      // CHECK DISPO
      // ==================================================

      const checkAutomation =
        config.automations?.checkDispo ||
        {};

      if (
        checkAutomation.enabled
      ) {
        if (
          safeArray(
            checkAutomation.times
          ).length
        ) {
          addCheck(
            checks,
            "ok",
            "Automation CheckDispo",
            `Activée : ${formatTimes(
              checkAutomation.times
            )}`
          );
        } else {
          addCheck(
            checks,
            "error",
            "Automation CheckDispo",
            "Activée mais aucun horaire configuré."
          );
        }
      } else {
        addCheck(
          checks,
          "info",
          "Automation CheckDispo",
          "Désactivée."
        );
      }

      // ==================================================
      // RAPPEL
      // ==================================================

      const rappelAutomation =
        config.automations?.rappel ||
        {};

      if (
        rappelAutomation.enabled
      ) {
        if (
          safeArray(
            rappelAutomation.times
          ).length
        ) {
          addCheck(
            checks,
            "ok",
            "Automation Rappel",
            `Activée : ${formatTimes(
              rappelAutomation.times
            )}`
          );
        } else {
          addCheck(
            checks,
            "error",
            "Automation Rappel",
            "Activée mais aucun horaire configuré."
          );
        }
      } else {
        addCheck(
          checks,
          "info",
          "Automation Rappel",
          "Désactivée."
        );
      }

      // ==================================================
      // AVERTISSEMENTS
      // ==================================================

      const warningAutomation =
        config.automations
          ?.avertissement ||
        {};

      const warningRoleIds =
        getWarningRoleIds(
          config
        );

      if (
        warningAutomation.enabled
      ) {
        if (
          !warningRoleIds[0]
        ) {
          addCheck(
            checks,
            "error",
            "Automation Avertissement",
            "Activée mais Avertissement 1 n'est pas configuré."
          );
        } else {
          const warningDetails =
            [];

          let warningError = false;

          for (
            let index = 0;
            index < 3;
            index++
          ) {
            const roleId =
              warningRoleIds[index];

            if (!roleId) {
              warningDetails.push(
                `${index + 1}️⃣ —`
              );

              continue;
            }

            const role =
              await guild.roles
                .fetch(roleId)
                .catch(() => null);

            if (!role) {
              warningError = true;

              warningDetails.push(
                `${STATUS.error} ${index + 1}️⃣ \`${roleId}\` introuvable`
              );
            } else if (
              !role.editable
            ) {
              warningError = true;

              warningDetails.push(
                `${STATUS.error} ${index + 1}️⃣ ${formatRole(role)} non modifiable`
              );
            } else {
              warningDetails.push(
                `${STATUS.ok} ${index + 1}️⃣ ${formatRole(role)}`
              );
            }
          }

          addCheck(
            checks,
            warningError
              ? "error"
              : "ok",
            "Automation Avertissement",
            warningDetails.join(
              "\n"
            ) +
              `\nDernier traitement : **${
                warningAutomation.lastProcessedDate ||
                "Jamais"
              }**`
          );
        }

        if (
          !safeArray(
            checkAutomation.times
          ).length
        ) {
          addCheck(
            checks,
            "error",
            "Déclenchement Avertissement",
            "L'avertissement dépend du dernier horaire CheckDispo, mais aucun horaire CheckDispo n'est configuré."
          );
        } else {
          const sortedTimes =
            [
              ...checkAutomation.times,
            ].sort(
              (a, b) =>
                String(a).localeCompare(
                  String(b)
                )
            );

          addCheck(
            checks,
            "ok",
            "Déclenchement Avertissement",
            `Dernier CheckDispo : **${sortedTimes.at(
              -1
            )}**`
          );
        }
      } else {
        addCheck(
          checks,
          "info",
          "Automation Avertissement",
          "Désactivée."
        );
      }

      // ==================================================
      // JOUEURS
      // ==================================================

      const players =
        guild.members.cache.filter(
          (member) =>
            member &&
            !member.user.bot &&
            playerRoleIds.some(
              (roleId) =>
                member.roles.cache.has(
                  roleId
                )
            )
        );

      addCheck(
        checks,
        "info",
        "Joueurs détectés",
        `**${players.size}** membre(s) correspondent aux rôles Joueurs configurés.`
      );

      // ==================================================
      // NICKNAMES MODIFIABLES
      // ==================================================

      const unmanageable =
        players.filter(
          (member) =>
            !member.manageable
        );

      if (
        unmanageable.size
      ) {
        addCheck(
          checks,
          "warning",
          "Nicknames non modifiables",
          `PROSYNC ne peut pas modifier **${unmanageable.size}** joueur(s), généralement à cause de la hiérarchie des rôles.\n${unmanageable
            .map(
              (member) =>
                `<@${member.id}>`
            )
            .slice(0, 20)
            .join(" ")}`
        );
      } else {
        addCheck(
          checks,
          "ok",
          "Nicknames modifiables",
          "Tous les joueurs détectés peuvent être gérés par PROSYNC."
        );
      }

      // ==================================================
      // RAPPORT FINAL
      // ==================================================

      const counts =
        countChecks(checks);

      const healthScore =
        Math.max(
          0,
          100 -
            counts.error * 15 -
            counts.warning * 5
        );

      const summaryEmbed =
        new EmbedBuilder()
          .setTitle(
            "🩺 PROSYNC — Diagnostic"
          )
          .setColor(
            getStatusColor(
              counts
            )
          )
          .setDescription(
            `Serveur : **${guild.name}**\n\n` +
              `Santé estimée : **${healthScore}%**\n\n` +
              `${STATUS.ok} OK : **${counts.ok}**\n` +
              `${STATUS.warning} Avertissements : **${counts.warning}**\n` +
              `${STATUS.error} Erreurs : **${counts.error}**\n` +
              `${STATUS.info} Informations : **${counts.info}**`
          )
          .setFooter({
            text: "PROSYNC",
          })
          .setTimestamp();

      const problemChecks =
        checks.filter(
          (check) =>
            check.level ===
              "error" ||
            check.level ===
              "warning"
        );

      const okChecks =
        checks.filter(
          (check) =>
            check.level === "ok"
        );

      const infoChecks =
        checks.filter(
          (check) =>
            check.level === "info"
        );

      const embeds = [
        summaryEmbed,
      ];

      if (
        problemChecks.length
      ) {
        const problemEmbed =
          new EmbedBuilder()
            .setTitle(
              "⚠️ Problèmes détectés"
            )
            .setColor(
              counts.error
                ? 0xed4245
                : 0xfee75c
            )
            .setDescription(
              problemChecks
                .map(checkLine)
                .join("\n\n")
                .slice(
                  0,
                  4000
                )
            )
            .setFooter({
              text: "PROSYNC",
            });

        embeds.push(
          problemEmbed
        );
      }

      if (
        okChecks.length
      ) {
        const okEmbed =
          new EmbedBuilder()
            .setTitle(
              "✅ Vérifications réussies"
            )
            .setColor(
              0x57f287
            )
            .setDescription(
              okChecks
                .map(checkLine)
                .join("\n\n")
                .slice(
                  0,
                  4000
                )
            )
            .setFooter({
              text: "PROSYNC",
            });

        embeds.push(
          okEmbed
        );
      }

      if (
        infoChecks.length
      ) {
        const infoEmbed =
          new EmbedBuilder()
            .setTitle(
              "ℹ️ Informations"
            )
            .setColor(
              0x5865f2
            )
            .setDescription(
              infoChecks
                .map(checkLine)
                .join("\n\n")
                .slice(
                  0,
                  4000
                )
            )
            .setFooter({
              text: "PROSYNC",
            });

        embeds.push(
          infoEmbed
        );
      }

      return interaction.editReply({
        embeds:
          embeds.slice(
            0,
            10
          ),
      });
    } catch (error) {
      console.error(
        "[PROSYNC][DIAGNOSTIC]",
        error
      );

      try {
        if (
          interaction.deferred
        ) {
          await interaction
            .editReply({
              content:
                "⚠️ Erreur pendant le diagnostic PROSYNC.",
            })
            .catch(() => {});
        } else if (
          !interaction.replied
        ) {
          await interaction
            .reply({
              content:
                "⚠️ Erreur pendant le diagnostic PROSYNC.",
              flags:
                MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
      } catch {}
    }
  },
};
