// Base types
export * from "./base";

// API endpoint types
export * from "./global-search";
export * from "./suggest-in-merchant";
export * from "./multicart";
export * from "./orders";
export * from "./checkout";
export * from "./address";

// Re-export request types for convenience
export type {
	GlobalSearchRequest,
	GlobalSearchResponse,
	GlobalSearchMerchant,
	GlobalSearchProduct,
} from "./global-search";

export type {
	SuggestInMerchantRequest,
	SuggestInMerchantResponse,
	SuggestInMerchantProduct,
} from "./suggest-in-merchant";

export type {
	MulticartSyncRequest,
	MulticartSyncResponse,
	MulticartSyncItem,
} from "./multicart";

export type { OpenOrdersResponse, Order, OrderStatus } from "./orders";

export type {
	CheckoutAddress,
	PaymentMethod,
	PaymentMethodType,
	CheckoutOrderSummary,
	CheckoutItem,
	PlaceOrderRequest,
	PlaceOrderResponse,
	PlaceOrderData,
} from "./checkout";

export type {
	SavedAddressesResponse,
	SavedAddress,
	AddressDetail,
	TenantInfo,
	LocationTokenData,
} from "./address";
