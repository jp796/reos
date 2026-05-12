/**
 * LinkedInPostService
 *
 * Publishes a UGC post on behalf of the authenticated LinkedIn member.
 *
 * Text-only posts: single POST to /v2/ugcPosts with the SHARE
 * shareMediaCategory = NONE.
 *
 * Posts with an image (photoUrl from PropertyPhotoService):
 *   1. POST /v2/assets?action=registerUpload — get an upload URL
 *   2. PUT the image bytes to that URL
 *   3. POST /v2/ugcPosts with shareMediaCategory = IMAGE referencing
 *      the registered asset URN
 *
 * Token: the stored member access token. URN: `urn:li:person:<id>`,
 * stored at connect time so we don't have to re-resolve it.
 */

import type { PrismaClient } from "@prisma/client";
import {
  LinkedInOAuthService,
  DEFAULT_LINKEDIN_SCOPES,
} from "@/services/integrations/LinkedInOAuthService";
import { getEncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";

const LINKEDIN_API = "https://api.linkedin.com";

export interface PostInput {
  accountId: string;
  text: string;
  /** Optional URL to fetch + attach. Public URL — we proxy-download
   * the bytes server-side, then upload to LinkedIn's CDN. */
  photoUrl?: string | null;
}

export interface PostResult {
  ok: true;
  /** LinkedIn share URN — `urn:li:share:<id>`. */
  shareUrn: string;
  /** Public URL of the published post. */
  postUrl: string;
}

export async function publishToLinkedIn(
  db: PrismaClient,
  input: PostInput,
): Promise<PostResult> {
  if (
    !env.LINKEDIN_CLIENT_ID ||
    !env.LINKEDIN_CLIENT_SECRET ||
    !env.LINKEDIN_REDIRECT_URI
  ) {
    throw new Error("LinkedIn OAuth not configured");
  }

  const oauth = new LinkedInOAuthService(
    {
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      redirectUri: env.LINKEDIN_REDIRECT_URI,
      scopes: DEFAULT_LINKEDIN_SCOPES,
    },
    db,
    getEncryptionService(),
  );
  const tokens = await oauth.getStoredTokens(input.accountId);
  if (!tokens) {
    throw new Error("LinkedIn not connected for this account");
  }

  const { accessToken, memberUrn } = tokens;

  // Resolve an image asset URN when there's a photo to attach.
  let mediaAsset: string | null = null;
  if (input.photoUrl) {
    mediaAsset = await uploadImageAsset(memberUrn, accessToken, input.photoUrl);
  }

  // Build the UGC post body. Schema reference:
  // https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-post-api
  const body = {
    author: memberUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: input.text },
        shareMediaCategory: mediaAsset ? "IMAGE" : "NONE",
        ...(mediaAsset
          ? {
              media: [
                {
                  status: "READY",
                  media: mediaAsset,
                  // Description + title are optional but recommended for accessibility.
                  description: { text: "Listing photo" },
                  title: { text: "REOS-published listing" },
                },
              ],
            }
          : {}),
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const res = await fetch(`${LINKEDIN_API}/v2/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // X-Restli-Protocol-Version is required for v2 endpoints.
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`LinkedIn ugcPosts ${res.status}: ${err.slice(0, 300)}`);
  }
  const shareUrn = res.headers.get("x-restli-id") ?? "";
  return {
    ok: true,
    shareUrn,
    postUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(shareUrn)}/`,
  };
}

/**
 * Two-step image asset upload:
 *   1. Register an upload (returns asset URN + upload URL)
 *   2. PUT the image bytes to that URL
 * Returns the asset URN to reference in the UGC post body.
 */
async function uploadImageAsset(
  ownerUrn: string,
  accessToken: string,
  photoUrl: string,
): Promise<string> {
  // 1. Register upload
  const regRes = await fetch(`${LINKEDIN_API}/v2/assets?action=registerUpload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: ownerUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
      },
    }),
  });
  if (!regRes.ok) {
    const err = await regRes.text().catch(() => "");
    throw new Error(
      `LinkedIn registerUpload ${regRes.status}: ${err.slice(0, 300)}`,
    );
  }
  const reg = (await regRes.json()) as {
    value?: {
      asset?: string;
      uploadMechanism?: {
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: {
          uploadUrl?: string;
        };
      };
    };
  };
  const uploadUrl =
    reg.value?.uploadMechanism?.[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ]?.uploadUrl;
  const assetUrn = reg.value?.asset;
  if (!uploadUrl || !assetUrn) {
    throw new Error("LinkedIn registerUpload returned no uploadUrl/asset");
  }

  // 2. Fetch the source image bytes (the photo URL we scraped).
  const photoRes = await fetch(photoUrl);
  if (!photoRes.ok) {
    throw new Error(`Photo fetch ${photoRes.status} from ${photoUrl}`);
  }
  const bytes = await photoRes.arrayBuffer();

  // 3. PUT the bytes to LinkedIn's upload URL.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: bytes,
  });
  if (!putRes.ok) {
    const err = await putRes.text().catch(() => "");
    throw new Error(`LinkedIn asset PUT ${putRes.status}: ${err.slice(0, 300)}`);
  }

  return assetUrn;
}
