import libnpmorg from 'libnpmorg';
import { Octokit } from '@octokit/rest';

export async function githubListUsers() {
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
}

export async function githubInviteUser(username: string) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  })

  try {
    const user = await octokit.request('GET /users/{username}', {
      username,
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
};

export async function npmListUsers(org: string) {
  if (!process.env.NPM_TOKEN) {
    throw new Error(`Env variable NPM_TOKEN not configured`);
  }

  const users = await libnpmorg.ls(org, {
    '//registry.npmjs.org/:_authToken': process.env.NPM_TOKEN,
  })

  return Object.entries(users).map(user => ({
    name: user[0],
    role: user[1],
  }));
};

export async function npmInviteUser(org: string, slug: string) {
  if (!process.env.NPM_TOKEN) {
    throw new Error(`Env variable NPM_TOKEN not configured`);
  }

  try {
    const membershipDetail = await libnpmorg.set(org, slug, 'developer', {
      '//registry.npmjs.org/:_authToken': process.env.NPM_TOKEN,
    })

    return membershipDetail;
  } catch (err) {
    return {
      error: err.message,
    }
  }
}
