import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get('org') || 'mui';

  try {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(`Env variable GITHUB_TOKEN not configured`);
    }

    if (!['mui', 'mui-org'].includes(org)) {
      throw new Error(`Org name ${org} not allowed`);
    }

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    const response = await octokit.request(`GET /orgs/${org}/members`, {
      per_page: 100,
      role: 'all',
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const users = response.data.map((user: any) => ({
      site_admin: user.site_admin,
      login: user.login,
      type: user.type,
    }));

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching GitHub users:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch users' },
      { status: 500 }
    );
  }
}