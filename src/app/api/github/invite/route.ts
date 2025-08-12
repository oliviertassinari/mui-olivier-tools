import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export async function POST(request: NextRequest) {
  try {
    const { username, org = 'mui' } = await request.json();

    if (!process.env.GITHUB_TOKEN) {
      throw new Error(`Env variable GITHUB_TOKEN not configured`);
    }

    if (!['mui', 'mui-org'].includes(org)) {
      throw new Error(`Org name ${org} not allowed`);
    }

    if (!username) {
      throw new Error('Username is required');
    }

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    const user = await octokit.request('GET /users/{username}', {
      username,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const invitation = await octokit.request(`POST /orgs/${org}/invitations`, {
      invitee_id: user.data.id,
      role: 'direct_member',
      team_ids: [],
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    return NextResponse.json(invitation.data);
  } catch (error: any) {
    console.error('Error inviting GitHub user:', error);
    const errorData = error.response?.data || { error: error.message };
    return NextResponse.json(errorData, { 
      status: error.response?.status || 500 
    });
  }
}