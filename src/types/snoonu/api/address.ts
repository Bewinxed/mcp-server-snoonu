import type { ApiResponse } from "./base";

/** GET https://admin.snoonu.com/api/v6/address */
export type SavedAddressesResponse = ApiResponse<SavedAddress[]>;

export interface SavedAddress {
	id: number;
	address: string;
	phone: string;
	latitude: number;
	longitude: number;
	notes: string | null;
	location_type: number;
	preferred_contact_method: number;
	address_details: AddressDetail[];
	custom_address_name: string;
	leave_at_the_door: boolean;
	ring_the_doorbell: boolean;
	tenant_info: TenantInfo;
}

export interface AddressDetail {
	/** 0 = building number, 1 = floor/flat, 8 = landmark/notes */
	address_detail_label: number;
	value: string;
}

export interface TenantInfo {
	country_name: string;
	invariant_country_name: string;
	city_name: string;
	invariant_city_name: string;
	country_iso3_code: string;
}

/** Shape of the locationToken cookie value (URL-encoded JSON) */
export interface LocationTokenData {
	id?: number;
	name: string;
	coordinates: {
		lat: number;
		lng: number;
	};
}
