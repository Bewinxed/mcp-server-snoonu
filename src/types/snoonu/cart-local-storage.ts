export interface CartItem {
	businessUnitId: string;
	businessUnitName: string;
	merchantId: number;
	name: string;
	englishName: string;
	id: number;
	productId: string;
	businessUnitMainCategoryId: string;
	imageUrl: string;
	images: string[];
	price: string;
	minPrice: number;
	basePrice: number;
	marketPlacePrice: number;
	marketPlaceDiscount: number;
	description: string;
	isInstock: boolean;
	discount: number;
	notRoundedDiscount: number;
	stockCount: number;
	promoted: number;
	hasBuyOneGetOne: boolean;
	additionalRequired: number;
	productOrderLimit: number;
	additionalData: any[];
	isAvailable: boolean;
	vertical: number;
	marketplaceMainCategories: string[];
	marketplaceSubCategories: string[];
	marketplaceProductGroups: string[];
	urlFriendlyName: string | null;
	productTags: Record<string, BySnoonu> | object;
	isDeleted: boolean;
	count: number;
	notes: string;
	uuid: string;
	totalPrice: number;
	selectedAdditional: any[];
	lastAddedIndex: number;
	productMerchant: null;
}

export interface ProductTags {
	SPlusFreeDelivery: BySnoonu;
	"By Snoonu": BySnoonu;
}

export interface BySnoonu {
	locales: Locales;
}

export interface Locales {
	en: Ar;
	ar: Ar;
}

export interface Ar {
	title: string;
}
