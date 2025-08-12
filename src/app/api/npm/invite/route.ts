import { NextRequest, NextResponse } from 'next/server';
import libnpmorg from 'libnpmorg';

export async function POST(request: NextRequest) {
  try {
    const { org, slug } = await request.json();

    if (!process.env.NPM_TOKEN) {
      throw new Error(`Env variable NPM_TOKEN not configured`);
    }

    if (!org || !slug) {
      throw new Error('Organization and slug parameters are required');
    }

    const membershipDetail = await libnpmorg.set(org, slug, null, {
      '//registry.npmjs.org/:_authToken': process.env.NPM_TOKEN,
    });

    return NextResponse.json(membershipDetail);
  } catch (error) {
    console.error('Error inviting npm user:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to invite user' },
      { status: 500 }
    );
  }
}