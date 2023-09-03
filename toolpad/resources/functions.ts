import org from 'libnpmorg';
import { Octokit } from '@octokit/rest';
import { createFunction } from '@mui/toolpad/server';

export const githubListUsers = createFunction(
  async () => {

  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  })

  const response = await octokit.request('GET /orgs/mui/members', {
    per_page: 100,
    role: 'all',
    headers: {
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  return response.data.map(user => ({
    site_admin: user.site_admin,
    login: user.login,
    type: user.type,
  }));
});

export const githubInviteUser = createFunction(
  async ({ parameters }) => {

  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  })

  try {
    const user = await octokit.request('GET /users/{username}', {
      username: parameters.username,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const invitation = await octokit.request('POST /orgs/mui/invitations', {
      invitee_id: user.data.id,
      role: 'direct_member',
      team_ids: [],
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    return invitation.data;
  } catch (err) {
    return err.response.data;
  }
}, {
  parameters: {
    username: {
      type: 'string',
    },
  },
},
);

export const npmListUsers = createFunction(
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

export const npmInviteUser = createFunction(
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