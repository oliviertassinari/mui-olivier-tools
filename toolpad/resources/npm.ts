import org from 'libnpmorg';

export async function listUsers() {
  if (!process.env.NPM_TOKEN) {
    throw new Error(`Env variable NPM_TOKEN not configured`);
  }

  const users = await org.ls('mui', {
    '//registry.npmjs.org/:_authToken': process.env.NPM_TOKEN,
  })

  return Object.entries(users).map(user => ({
    name: user[0],
    role: user[1],
  }));
}

export async function inviteUser(slug: string) {
  if (!process.env.NPM_TOKEN) {
    throw new Error(`Env variable NPM_TOKEN not configured`);
  }

  try {
    const membershipDetail = await org.set('mui', slug, 'developer', {
      '//registry.npmjs.org/:_authToken': process.env.NPM_TOKEN,
    })

    return membershipDetail;
  } catch (err) {
    return {
      error: err.message,
    }
  }
}
