import type { SupabaseClient } from "@supabase/supabase-js";

export class CampusError extends Error {}

export interface CampusListItem {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly cityName: string;
  readonly state: string;
  readonly isActive: boolean;
}

export interface NewCampus {
  readonly name: string;
  readonly cityName: string;
  readonly state: string;
  readonly code: string;
  readonly address: string;
  readonly primaryContactName: string;
  readonly primaryContactEmail: string;
  readonly primaryContactPhone: string;
}

export interface CampusRepository {
  list(): Promise<readonly CampusListItem[]>;
  create(input: NewCampus): Promise<void>;
  /** Retirement is deactivation. Nothing here is ever deleted. */
  setActive(id: string, isActive: boolean): Promise<void>;
}

export function createSupabaseCampusRepository(client: SupabaseClient): CampusRepository {
  /**
   * The city is typed on the campus form, not picked from a list, so it may
   * not exist yet. Resolving it here - rather than making the admin create a
   * city first - is what stops this screen inheriting the bootstrap deadlock
   * it exists to break.
   */
  async function resolveCityId(name: string, state: string): Promise<string> {
    const { data: existing } = await client
      .from("cities")
      .select("id")
      .ilike("name", name)
      .maybeSingle();

    if (existing !== null && existing !== undefined) return existing.id as string;

    const { data: created, error } = await client
      .from("cities")
      .insert({ name, state })
      .select("id")
      .single();

    if (error !== null || created === null) {
      throw new CampusError("Could not save the city. Please try again.");
    }
    return created.id as string;
  }

  return {
    async list() {
      const { data, error } = await client
        .from("campuses")
        .select("id, name, code, is_active, cities(name, state)")
        .order("name");

      if (error !== null) throw new CampusError("Could not load the campuses.");

      return (data ?? []).map((row): CampusListItem => {
        // PostgREST returns an embedded to-one relation as an object, but the
        // generated types describe it as an array. Normalise both.
        const raw = (row as Record<string, unknown>).cities;
        const city = (Array.isArray(raw) ? raw[0] : raw) as
          | { name?: string; state?: string }
          | null
          | undefined;

        return {
          id: row.id as string,
          name: row.name as string,
          code: row.code as string,
          cityName: city?.name ?? "",
          state: city?.state ?? "",
          isActive: row.is_active as boolean,
        };
      });
    },

    async create(input) {
      const cityId = await resolveCityId(input.cityName, input.state);

      const { error } = await client
        .from("campuses")
        .insert({
          name: input.name,
          city_id: cityId,
          code: input.code,
          address: input.address,
          primary_contact_name: input.primaryContactName,
          primary_contact_email: input.primaryContactEmail,
          primary_contact_phone: input.primaryContactPhone,
        })
        .select("id")
        .single();

      if (error !== null) {
        throw new CampusError(
          error.code === "23505"
            ? "That campus name or code is already taken."
            : "Could not save the campus. Please try again.",
        );
      }
    },

    async setActive(id, isActive) {
      const { error } = await client
        .from("campuses")
        .update({ is_active: isActive })
        .eq("id", id)
        .select("id")
        .single();

      if (error !== null) throw new CampusError("Could not update the campus.");
    },
  };
}
