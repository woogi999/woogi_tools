// A Roblox image ID to a picture URL, through the site's own Worker (for the
// JJS Stuff templates' 3D preview). Null when Roblox won't show it.
export async function textureUrl(id) {
  try {
    // eslint-disable-next-line warp-drive/no-external-request-patterns -- the site's own Worker
    const response = await fetch(
      `/api/roblox?kind=thumb&id=${encodeURIComponent(id)}`,
    );
    if (!response.ok) return null;
    return (await response.json())?.url ?? null;
  } catch {
    return null;
  }
}
