import { createFunction } from '@mui/toolpad/server';
import org from 'libnpmorg';

export const listUsers = createFunction(
  async () => {
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
  },
);

export const inviteUser = createFunction(
  async ({ parameters }) => {
    if (!process.env.NPM_TOKEN) {
      throw new Error(`Env variable NPM_TOKEN not configured`);
    }

    try {
      const membershipDetail = await org.set('mui', parameters.slug, 'developer', {
        '//registry.npmjs.org/:_authToken': process.env.NPM_TOKEN,
      })

      return membershipDetail;
    } catch (err) {
      return {
        error: err.message,
      }
    }
  },
  {
    parameters: {
      slug: {
        type: 'string',
      },
    },
  },
);