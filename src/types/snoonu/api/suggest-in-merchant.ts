import type { ApiResponse, BaseProduct, MerchantStatus } from "./base";

/** POST https://admin.snoonu.com/api/search/suggest_in_merchant_with_subcategory */
export interface SuggestInMerchantRequest {
	term: string;
	language: "en" | "ar";
	menu_id: number;
}

export type SuggestInMerchantResponse = ApiResponse<SuggestInMerchantData>;

export interface SuggestInMerchantData {
	product_view_models: SuggestInMerchantProduct[];
	sub_categories: SubCategory[];
}

export interface SubCategory {
	id: string;
	name: string;
	english_name: string;
	product_count: number;
}

export interface SuggestInMerchantProduct extends BaseProduct {
	brand_id: number;
	merchant_name: string;
	merchant_english_name: string | null;
	merchant_status: MerchantStatus | string;
	business_unit_id: string;
	is_food_merchant: boolean;
	branch_id: string | null;
}
