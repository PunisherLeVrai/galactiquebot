// src/core/memberDisplay.js
//
// Format final :
// PSEUDO | POSTE/POSTE | RÔLE
//
// PSEUDO :
// 1) pseudo enregistré depuis le salon pseudo
// 2) sinon username Discord
//
// Tout le nickname est en MAJUSCULES.

const { getUserPseudos } = require("./pseudoStore");

function cleanValue(value, max = 200) {
  return String(value ?? "")
    .replace(/[`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function upper(value) {
  return cleanValue(value).toLocaleUpperCase("fr-FR");
}

function normalizeUsername(username) {
  const value = cleanValue(username, 40);
  return value || "USER";
}

function pickBestPseudo(member) {
  const entry =
    getUserPseudos(
      member.guild.id,
      member.user.id
    ) || {};

  const customPseudo = cleanValue(
    entry.pseudo,
    40
  );

  if (customPseudo) {
    return customPseudo;
  }

  return normalizeUsername(
    member.user?.username
  );
}

function mapStaffRoleName(roleName) {
  const name = String(
    roleName || ""
  ).toLowerCase();

  if (
    name.includes("président") ||
    name.includes("president")
  ) {
    return "PRÉSIDENT";
  }

  if (
    name.includes("fondateur") ||
    name.includes("founder")
  ) {
    return "FONDATEUR";
  }

  if (
    name.includes("cogm") ||
    name.includes("co gm") ||
    name.includes("co-gm") ||
    name.includes("co_gm") ||
    name.includes("co general manager")
  ) {
    return "COGM";
  }

  if (
    /\bgm\b/.test(name) ||
    name.includes("general manager")
  ) {
    return "GM";
  }

  return upper(
    roleName || "STAFF"
  );
}

function resolveStaffRole(member, cfg) {
  if (!member) return null;

  const staffRoleIds =
    Array.isArray(
      cfg?.staffRoleIds
    )
      ? cfg.staffRoleIds.map(String)
      : [];

  if (!staffRoleIds.length) {
    return null;
  }

  const staffRoles =
    member.roles?.cache?.filter(
      (role) =>
        role &&
        staffRoleIds.includes(
          String(role.id)
        )
    );

  if (
    !staffRoles ||
    staffRoles.size === 0
  ) {
    return null;
  }

  const topRole = staffRoles
    .sort(
      (a, b) =>
        b.position - a.position
    )
    .first();

  if (!topRole) {
    return "STAFF";
  }

  return mapStaffRoleName(
    topRole.name
  );
}

function resolveConfiguredDisplayRole(
  member,
  cfg
) {
  const roleId =
    cfg?.displayRoleId
      ? String(
          cfg.displayRoleId
        )
      : null;

  if (!roleId) {
    return null;
  }

  if (
    !member.roles?.cache?.has(
      roleId
    )
  ) {
    return null;
  }

  const role =
    member.guild?.roles?.cache?.get(
      roleId
    ) ||
    member.roles.cache.get(
      roleId
    );

  if (!role) {
    return null;
  }

  return upper(
    role.name
  );
}

function resolveMainRole(
  member,
  cfg
) {
  return (
    resolveStaffRole(
      member,
      cfg
    ) ||
    resolveConfiguredDisplayRole(
      member,
      cfg
    )
  );
}

function resolvePosts(
  member,
  cfg
) {
  if (!member) {
    return [];
  }

  const ids =
    Array.isArray(
      cfg?.postRoleIds
    )
      ? cfg.postRoleIds
      : Array.isArray(
          cfg?.posts
        )
        ? cfg.posts
            .map(
              (post) =>
                post?.roleId
            )
            .filter(Boolean)
        : [];

  const orderedRoleIds =
    ids
      .map(String)
      .filter(Boolean);

  const posts = [];

  for (
    const roleId of
    orderedRoleIds
  ) {
    if (
      !member.roles.cache.has(
        roleId
      )
    ) {
      continue;
    }

    const role =
      member.guild?.roles?.cache?.get(
        roleId
      ) ||
      member.roles.cache.get(
        roleId
      );

    const roleName =
      upper(
        role?.name
      );

    if (roleName) {
      posts.push(
        roleName
      );
    }

    if (
      posts.length >= 3
    ) {
      break;
    }
  }

  return posts;
}

function fitNickname(
  postsText,
  roleText,
  pseudoText
) {
  const parts = [];

  if (pseudoText) {
    parts.push(
      pseudoText
    );
  }

  if (postsText) {
    parts.push(
      postsText
    );
  }

  if (roleText) {
    parts.push(
      roleText
    );
  }

  return parts
    .join(" | ")
    .slice(0, 32);
}

function buildMemberLine(
  member,
  cfg
) {
  const pseudo =
    upper(
      pickBestPseudo(
        member
      )
    );

  const role =
    upper(
      resolveMainRole(
        member,
        cfg
      )
    );

  const posts =
    resolvePosts(
      member,
      cfg
    ).map(upper);

  const postsText =
    posts.join("/");

  return fitNickname(
    postsText,
    role,
    pseudo
  );
}

module.exports = {
  buildMemberLine,
  resolveMainRole,
  resolveStaffRole,
  resolveConfiguredDisplayRole,
  resolvePosts,
  pickBestPseudo,
};
