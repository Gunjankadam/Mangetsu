
export interface AniListManga {
  id: number;
  title: {
    romaji: string;
    english: string | null;
    native: string | null;
  };
  synonyms: string[];
  chapters: number | null;
  status: string;
  bannerImage: string | null;
  averageScore: number | null;
  description: string | null;
}

const ANALIST_API_URL = 'https://graphql.anilist.co';

export function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

export async function searchAniList(title: string): Promise<AniListManga | null> {
  const query = `
    query ($search: String) {
      Page(perPage: 1) {
        media(search: $search, type: MANGA) {
          id
          title {
            romaji
            english
            native
          }
          synonyms
          chapters
          status
          bannerImage
          averageScore
          description
        }
      }
    }
  `;

  try {
    const response = await fetch(ANALIST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { search: title },
      }),
    });

    const json = await response.json();
    return json.data?.Page?.media?.[0] || null;
  } catch (err) {
    console.error('AniList search error:', err);
    return null;
  }
}

export async function fetchAniListDetails(id: number): Promise<AniListManga | null> {
    const query = `
      query ($id: Int) {
        Media(id: $id, type: MANGA) {
            id
            title {
              romaji
              english
              native
            }
            synonyms
            chapters
            status
            bannerImage
            averageScore
            description
        }
      }
    `;
  
    try {
      const response = await fetch(ANALIST_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { id },
        }),
      });
  
      const json = await response.json();
      return json.data?.Media || null;
    } catch (err) {
      console.error('AniList fetch error:', err);
      return null;
    }
  }
