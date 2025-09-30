export interface MerchantPageData {
	props: Props;
	page: string;
	query: Query;
	buildId: string;
	isFallback: boolean;
	isExperimentalCompile: boolean;
	gssp: boolean;
	locale: string;
	locales: string[];
	defaultLocale: string;
	scriptLoader: ScriptLoader[];
}

export interface Props {
	pageProps: PageProps;
	__N_SSP: boolean;
}

export interface PageProps {
	props: null;
	seoMeta: SEO;
	seoPageContent: SEO;
	messages: Messages;
	hydrationData: HydrationData;
}

export interface HydrationData {
	merchantPageStore: MerchantPageStore;
	merchantSubcategoriesStore: MerchantSubcategoriesStore;
}

export interface MerchantPageStore {
	outOfRange: boolean;
	merchant: Merchant;
	featuredProducts: FeaturedProduct[];
	menuCategories: MenuCategory[];
	activeCategory: ActiveCategory;
	activeCategoryProducts: ActiveCategoryProduct[];
}

export interface ActiveCategory {
	id: number;
	name: string;
}

export interface ActiveCategoryProduct {
	isFavoriteProduct: boolean;
	name: string;
	englishName: string;
	id: number;
	productId: string;
	businessUnitMainCategoryId: "61820a73c77f5ff17a305c1a";
	imageUrl: string;
	images: string[];
	price: string;
	priceOld?: string;
	minPrice: number;
	basePrice: number;
	marketPlacePrice: number;
	marketPlaceDiscount: number;
	description: string;
	isInstock: boolean;
	discount: number;
	notRoundedDiscount: number;
	ignorePromoted: boolean;
	stockCount: number;
	isLowStock: boolean;
	promoted: number;
	hasBuyOneGetOne: boolean;
	additionalRequired: number;
	productOrderLimit: number;
	additionalData: AdditionalDatum[];
	isAvailable: boolean;
	vertical: number;
	marketplaceMainCategories: any[];
	marketplaceSubCategories: any[];
	marketplaceProductGroups: any[];
	productTags: ProductTags;
}

export interface AdditionalDatum {
	id: string;
	name: string;
	englishName: string;
	viewType: number;
	mode: number;
	min: number;
	max: number;
	isSameImage: boolean;
	data: Datum[];
}

export interface Datum {
	id: number;
	additionalOptionId: string;
	name: string;
	englishName: string;
	price: string;
	isDefault: boolean;
	image: string;
	mainImage: string;
	isAvailable: boolean;
	priceRaw: number;
}

export interface ProductTags {}

export interface FeaturedProduct {
	categoryId: number;
	menuId: number;
	type: string;
	createdAt: string;
	updatedAt: string;
	status: number;
	minDay: number;
	timeAverage: number;
	sort: number;
	deleted: boolean;
	required: number;
	changeStatus: number;
	externalId: number;
	imageCover: number;
	taxValue: number;
	cityId: number;
	isFavoriteProduct: boolean;
	isWishlist: number;
	merchantId: number;
	isPopular: boolean;
	isSupportFreshnessGuarantees: boolean;
	name: string;
	englishName: string;
	id: number;
	productId: string;
	businessUnitMainCategoryId: "61820a73c77f5ff17a305c1a";
	imageUrl: string;
	images: string[];
	price: string;
	priceOld?: string;
	minPrice: number;
	basePrice: number;
	marketPlacePrice: number;
	marketPlaceDiscount: number;
	description: string;
	isInstock: boolean;
	discount: number;
	notRoundedDiscount: number;
	ignorePromoted: boolean;
	stockCount: number;
	isLowStock: boolean;
	promoted: number;
	hasBuyOneGetOne: boolean;
	additionalRequired: number;
	productOrderLimit: number;
	additionalData: AdditionalDatum[];
	isAvailable: boolean;
	vertical: number;
	marketplaceMainCategories: any[];
	marketplaceSubCategories: any[];
	marketplaceProductGroups: any[];
	productTags: ProductTags;
}

export interface MenuCategory {
	id: number;
	name: string;
	data: ActiveCategoryProduct[];
}

export interface Merchant {
	id: number;
	orderId: number;
	merchantId: number;
	name: string;
	englishName: string;
	lat: string;
	lng: string;
	menuId: number;
	businessUnitId: string;
	productView: string;
	description: string;
	isOwnDelivery: boolean;
	imageUrl: string;
	isMerchantOpen: number;
	tag: string[];
	rating: string;
	ratingDetails: RatingDetails;
	statusMerchant: string;
	openingStatusText: string;
	distance: string;
	infoMerchant: InfoMerchant;
	timeValue: string;
	timeUnit: string;
	weekdayAvailabilities: WeekdayAvailability[];
	isFoodMerchant: boolean;
	businessUnitMainCategory: BusinessUnitMainCategory;
	businessUnitMainCategoryId: "61820a73c77f5ff17a305c1a";
	branchId: string;
	isPromoted: boolean;
	promotions: Promotion[];
	urlFriendlyName: string;
	isAvailableForDeliveryNow: boolean;
	consultation: Consultation;
	averageOrderValueDefinition: number;
	isFavoriteMerchant: boolean;
	vertical: number;
}

export interface BusinessUnitMainCategory {
	legacyLinkId: number;
	parentId: string;
	hasChildren: boolean;
	viewType: number;
	ncrEnabled: boolean;
	featuredBrandIds: string[];
	businessType: number;
	isDraftProductAllowed: boolean;
	images: Image[];
	locales: Locale[];
	status: number;
	sortOrder: number;
	isMainCategory: boolean;
	isActive: boolean;
	tagIds: any[];
	promotionalSettings: any[];
	navigationType: number;
	isPromotionalCategory: boolean;
	subscriptionSettings: SubscriptionSettings;
	id: "61820a73c77f5ff17a305c1a";
	name: string;
	createdAt: Date;
	updatedAt: Date;
	isDeleted: boolean;
}

export interface Image {
	imageUri: string;
	imageKind: string;
	localeType: string;
	modifiedAt: Date;
}

export interface Locale {
	localeType: string;
	name: string;
	description: string;
	shortDescription: string;
}

export interface SubscriptionSettings {
	sPlus: SPlus;
}

export interface SPlus {
	deliveryFeeTermsCollection: { [key: string]: DeliveryFeeTermsCollection };
}

export interface DeliveryFeeTermsCollection {
	distanceRange: ERange;
	orderValueRange: ERange;
}

export interface ERange {
	from: number;
	to: number;
}

export interface Consultation {
	phone: string;
	enableCall: boolean;
}

export interface InfoMerchant {
	status: string;
	time: string;
	title: string;
	message: string;
	isAlwaysAvailable: boolean;
}

export interface Promotion {
	kind: number;
	value: string;
}

export interface RatingDetails {
	ratingValue: number;
	totalRatings: number;
	displayedTotalRatings: string;
	isDisplayable: boolean;
}

export interface WeekdayAvailability {
	day: number;
	openingTime: number;
	closingTime: number;
	isClosed: boolean;
	createdAt: Date;
	updatedAt: Date;
	statusUpdateReasonId: string;
}

export interface MerchantSubcategoriesStore {
	subcategoryList: any[];
}

export interface Messages {
	Header: Header;
	Subheader: Subheader;
	Account: Account;
	Login: Login;
	Location: Location;
	Search: Search;
	Footer: Footer;
	MenuCategories: MenuCategories;
	CategoriesDescriptions: CategoriesDescriptions;
	MerchantMetaData: { [key: string]: UnableToDelete };
	HomePage: HomePage;
	MerchantPage: MerchantPage;
	NotFoundPage: NotFoundPage;
	DealsPage: DealsPage;
	Common: Common;
	ProductCard: ProductCard;
	Cart: Cart;
	Checkout: Checkout;
	CreditCard: CreditCard;
	OrderTracking: OrderTracking;
	TryAgain: TryAgain;
	OrderHistory: OrderHistory;
	Feedback: Feedback;
	ScheduleDelivery: ScheduleDelivery;
	SiteMap: SiteMap;
	RestrictedZoneModal: RestrictedZoneModal;
	NoResultsFilter: NoResultsFilter;
	OutOfCoverage: OutOfCoverage;
	ProductPage: ProductPage;
	sortBy: SortBy;
	ErrorPage: ErrorPage;
	PriceRangeFilter: PriceRangeFilter;
	CartRecommendation: CartRecommendation;
	Favourites: Favourites;
	SnooSim: SnooSim;
	Rating: Rating;
	ChangePhone: ChangePhone;
	ReviewModal: ReviewModal;
	SCity: SCity;
	Dates: Dates;
	LoginPopup: LoginPopup;
	DownloadAppBanner: DownloadAppBanner;
	DiscountInfoBox: DiscountInfoBox;
}

export interface Account {
	myAccount: string;
	name: string;
	email: string;
	phone: string;
	save: string;
	notification: Notification;
	delete: AccountDelete;
	unableToDelete: UnableToDelete;
	info: string;
	snoonuWallet: string;
	logoutConfirm: string;
	login: string;
}

export interface AccountDelete {
	title: string;
	confirm: string;
	description: string;
	cancel: string;
	deleted: string;
}

export interface Notification {
	email: string;
	phone: string;
}

export interface UnableToDelete {
	title: string;
	description: string;
}

export interface Cart {
	checkout: string;
	cart: string;
	confirmDelete: string;
	rejectDelete: string;
	willDeleted: string;
	emptyCart: string;
	addRequestProducts: string;
	addRequestProductsNonFood: string;
	addRequest: string;
	goToCart: string;
	addToCart: string;
	add: string;
	specialRequest: string;
	oops: string;
	cantDeliveryTo: string;
	confirmEmptyCart: string;
	keepPrevLocation: string;
	hasUnavailableProductsOnLocationChange: string;
	hasUnavailableProductsOnCheckout: string;
	allProductsIsUnAvailable: string;
	addOtherItems: string;
	proceedAnyway: string;
	merchantNoLongerAvailable: string;
	tryAnotherMerchant: string;
	optional: string;
	freeDelivery: string;
	awesomeFreeDelivery: string;
	merchantClosed: string;
	yourChoice: string;
	removeDelivery: string;
	confirmRemove: string;
	rejectRemove: string;
	unavailable: string;
	replace: string;
	outOfStock: string;
	deleteAll: string;
	alreadyInYourCart: string;
	addAnotherOption: string;
	deliveryBy: DeliveryBy;
	comeBackLater: string;
	added: string;
	buyNow: string;
}

export interface DeliveryBy {
	snoonu: string;
	merchant: string;
}

export interface CartRecommendation {
	title: string;
}

export interface CategoriesDescriptions {
	electronics: string;
	restaurants: string;
	"flowers-and-gifts": string;
	groceries: string;
	"kids-and-stationery": string;
	"beauty-and-perfumes": string;
	pharmacy: string;
	"online-shopping": string;
	"coffee-and-sweets": string;
	pets: string;
	red: string;
	"affiliates-delivery": string;
	"go-green": string;
	new: string;
	"free-delivery": string;
	corporate: string;
	"24-hours-delivery": string;
	charities: string;
	"beat-the-heat": string;
	"summer-specials": string;
	pizza: string;
	sweets: string;
	"mixed-grill": string;
	"back-to-school": string;
	"affordable-offers": string;
	"try-local": string;
	"party-and-events": string;
	"fans-collection": string;
}

export interface ChangePhone {
	unlockAccount: string;
	title: string;
	unlockPaymentMethods: string;
	info: string;
	unlockPaymentMethodsFull: string;
	changeNumber: string;
	changedToLocal: string;
}

export interface Checkout {
	deliveryAddress: string;
	recipientDetails: string;
	recipientDetailsDesc: string;
	whatsapp: string;
	mobileNumber: string;
	fillTheNumber: string;
	payWith: string;
	cash: string;
	card: string;
	applePay: string;
	ooredooMoney: string;
	debit_card: string;
	debitCardConfirm: DebitCardConfirm;
	debit_card_desc: string;
	google_pay: string;
	googlePayNotReady: string;
	chooseMethod: string;
	snoonuWallet: string;
	useWallet: string;
	walletInfo: string;
	done: string;
	products: string;
	deliveryFee: string;
	total: string;
	placeOrder: string;
	paymentFailed: string;
	yourOrder: string;
	clearCart: string;
	yourOrderAccepted: string;
	yourOrderPlaced: string;
	success: string;
	restaurantWillAccept: string;
	cancelOrder: string;
	restaurantIsPreparing: string;
	orderHasBeenCancelled: string;
	cancelledDesc: string;
	cancelOrderConfirm: string;
	orderAccepted: string;
	cancelReject: string;
	cancelConfirm: string;
	yes: string;
	no: string;
	yourOrderWasCancelled: string;
	addComments: string;
	thanksForFeedback: string;
	feedbackDescription: string;
	ok: string;
	cancelDone: string;
	paidWith: string;
	orderQRDesc: string;
	backToHome: string;
	trackYourOrder: string;
	goToApp: string;
	voucher: Voucher;
	items: string;
	contactSupport: string;
	cancelOrderBtn: string;
	contactSupportBtn: string;
	closeBtn: string;
	somethingWentWrong: string;
	unexpectedError: string;
	contact: string;
	close: string;
}

export interface DebitCardConfirm {
	title: string;
	desc: string;
	proceed: string;
}

export interface Voucher {
	title: string;
	add: string;
	enter: string;
	apply: string;
	invalid: string;
	cancel: string;
	error: string;
	applied: string;
	info: string;
}

export interface Common {
	snoonu: string;
	fields: CommonFields;
	ad: string;
	ok: string;
	errorTryAgain: string;
	pointYourCamera: string;
	download: Download;
	no: string;
	yes: string;
	showMore: string;
	showLess: string;
	more: string;
	less: string;
	goBack: string;
	price: string;
	favouriteBrands: string;
	seeAll: string;
	promo: string;
	seeMore: string;
	seeLess: string;
	filters: string;
	apply: string;
	close: string;
	clearAll: string;
	market: string;
}

export interface Download {
	full: string;
	short: string;
}

export interface CommonFields {
	isRequired: string;
	invalidEmailFormat: string;
}

export interface CreditCard {
	savedCards: string;
	emptyCards: string;
	addNewCard: string;
	saveCard: string;
	needsVerification: string;
	deleteConfirm: string;
	verifyCard: string;
	verify: string;
	errors: Errors;
	fields: CreditCardFields;
}

export interface Errors {
	add: string;
	verify: string;
}

export interface CreditCardFields {
	invalidCardNumber: string;
	invalidCardDate: string;
	invalidCardCode: string;
}

export interface Dates {
	date: string;
	today: string;
	tomorrow: string;
	thisWeek: string;
	thisMonth: string;
}

export interface DealsPage {
	title: string;
	description: string;
	seeAll: string;
	cardVoucher: CardVoucher;
	deals: { [key: string]: Empty };
}

export interface CardVoucher {
	title: string;
	subtitle: string;
}

export interface Empty {
	title: string;
	desc: string;
}

export interface DiscountInfoBox {
	deal: string;
	discount: string;
}

export interface DownloadAppBanner {
	title: string;
	download: string;
}

export interface ErrorPage {
	title: string;
	description: string;
	heading: string;
	subTitle: string;
	link: string;
	retry: string;
}

export interface Favourites {
	favourites: string;
	items: string;
	empty: UnableToDelete;
	restaurantsAndShops: string;
	allItems: string;
	addedToFavourites: string;
	removedFromFavourites: string;
}

export interface Feedback {
	writeToUs: string;
	placeholder: string;
	send: string;
}

export interface Footer {
	sitemap: string;
	privacyPolicy: string;
	termsAndServices: string;
	becomePartner: string;
	moreServices: string;
	backToTop: string;
	laundry: string;
	laundrySub: string;
	sCity: string;
	sCitySub: string;
	snooSend: string;
	snooSendSub: string;
	prime: string;
	primeSub: string;
	takeAway: string;
	takeAwaySub: string;
}

export interface Header {
	catalog: string;
	login: string;
	logout: string;
	myOrders: string;
}

export interface HomePage {
	title: string;
	offers: string;
	trendingMerchants: string;
	trendingCategories: string;
}

export interface Location {
	select: string;
	selectAddress: string;
	selectYourAddress: string;
	selectYourAddressDesc: string;
	locateMe: string;
	doha: string;
	orderToThisAddress: string;
	yes: string;
	no: string;
	yourAddress: string;
	confirm: string;
	startTyping: string;
	noData: string;
	myLocations: string;
	myAddresses: string;
	addNewAddress: string;
	addAddress: string;
	emptyAddresses: string;
	unavailableToDeliver: string;
	geolocationError: string;
	deliveryAddress: string;
	address: string;
	addressName: string;
	numberOnDoor: string;
	preferredContact: string;
	whatsapp: string;
	phoneCall: string;
	otherInfo: string;
	preferredContactDesc: string;
	addressDetails: string;
	addressDetailsDesc: string;
	buildingNumber: string;
	house: string;
	"apartment/Hotel": string;
	office: string;
	other: string;
	apartment: string;
	phone: string;
	notes: string;
	saveAddress: string;
	delete: LocationDelete;
	skip: string;
}

export interface LocationDelete {
	label: string;
	title: string;
	confirm: string;
	yes: string;
	no: string;
}

export interface Login {
	modalTitleStep1: string;
	loginDiscount: string;
	loginDiscountSub: string;
	buttonContinue: string;
	conditionsAlert: string;
	termsConditions: string;
	modalTitleStep2: string;
	requestPinTimeout: string;
	buttonRequestPin: string;
	invalidPin: string;
	modalTitleStep3: string;
	fieldLabelName: string;
	fieldLabelEmail: string;
	buttonRegister: string;
	countryCode: string;
	choose: string;
	mobileNumber: string;
	searchCountry: string;
	addCountry: string;
	requestSent: string;
	requestSentDesc: string;
	backToSignUp: string;
	continueWith: string;
	emailInUse: string;
	apple: string;
	google: string;
}

export interface LoginPopup {
	title: string;
	description: string;
	continue: string;
}

export interface MenuCategories {
	all: string;
	restaurants: string;
	groceries: string;
	grocery: string;
	electronics: string;
	"online-shopping": string;
	"flowers-and-gifts": string;
	"beauty-and-perfumes": string;
	pharmacy: string;
	"kids-and-stationery": string;
	"coffee-and-sweets": string;
	pets: string;
	homePage: string;
	termsAndServices: string;
	privacyPolicy: string;
	deals: string;
	red: string;
	"affiliates-delivery": string;
	"go-green": string;
	new: string;
	"free-delivery": string;
	corporate: string;
	"24-hours-delivery": string;
	charities: string;
	"beat-the-heat": string;
	"summer-specials": string;
	pizza: string;
	sweets: string;
	"mixed-grill": string;
	"back-to-school": string;
	"affordable-offers": string;
	"try-local": string;
	"party-and-events": string;
	"fans-collection": string;
	orders: string;
	snoomart: string;
	snoopharma: string;
	snoosend: string;
	"health-and-beauty": string;
	"baby-and-kids": string;
	"books-and-stationery": string;
	"sport-and-outdoors": string;
	"household-and-garden": string;
	"clothes-and-accessories": string;
	favourites: string;
	"all-services": string;
	"s-city": string;
}

export interface MerchantPage {
	bestSelling: string;
	deliveryTime: string;
	distance: string;
	workingHours: string;
	priceRange: string;
	until: string;
	rating: string;
	orderFromOtherMerchant: string;
	filterPresets: FilterPresets;
	nothingFoundInMerchantPage: string;
	searchInMerchantPlaceholder: string;
}

export interface FilterPresets {
	freeDelivery: string;
	under30min: string;
	less50qr: string;
	takeAway: string;
}

export interface NoResultsFilter {
	noResultFound: string;
	tryChangingFilters: string;
	tryChangingFiltersShort: string;
	changeLocation: string;
	clearAllFilters: string;
	checkSpelling: string;
	checkSpellingFull: string;
}

export interface NotFoundPage {
	title: string;
	link: string;
}

export interface OrderHistory {
	title: string;
	support: string;
	reOrder: string;
	yourOrder: string;
	quantity: string;
	paid: string;
	details: string;
	copied: string;
	snoosendDesc: string;
	trackOrder: string;
	goToApp: string;
	empty: Empty;
	refundToSnoonuWallet: string;
	refundToCard: string;
	refundAmountCard: string;
	refundInfo: string;
	refundInfoDescription: string;
	refundStatusFailed: string;
	refundStatusSuccess: string;
	oops: string;
	chatWithUs: string;
	deliveryTimeApprox: string;
	deliveryBy: string;
}

export interface OrderTracking {
	trackOrder: string;
}

export interface OutOfCoverage {
	outOfCoverageHeading: string;
	outOfCoverageText: string;
	canNotDeliver: string;
	changeLocation: string;
	showOtherMerchants: string;
}

export interface PriceRangeFilter {
	min: string;
	max: string;
	currency: string;
}

export interface ProductCard {
	left: string;
	outOfStock: string;
	add: string;
	promo: string;
	free: string;
	addSpecialRequest: string;
	editSpecialRequest: string;
	quantityLimit: string;
}

export interface ProductPage {
	buyItWith: string;
	productsFrom: string;
	moreFrom: string;
	outOfCoverage: string;
}

export interface Rating {
	rating0: string;
	rating1: string;
	rating2: string;
	rating3: string;
	rating4: string;
	rating5: string;
}

export interface RestrictedZoneModal {
	restrictedDeliveryTitle: string;
	restrictedDeliveryText: string;
	redZoneHeading: string;
	yellowZoneHeading: string;
	neutralZoneHeading: string;
	redZoneText: string;
	yellowZoneText: string;
	neutralZoneText: string;
	changeLocation: string;
}

export interface ReviewModal {
	title: string;
	reviewPlaceholder: string;
	addPhotos: string;
	addPhotosCaption: string;
	anonymous: string;
	anonymousCaption: string;
	send: string;
	success: string;
	successCaption: string;
	failure: string;
	failureCaption: string;
	closeReview: string;
	closeReviewDesc: string;
	closeReviewAccept: string;
	closeReviewDeny: string;
	chooseImages: string;
	dragImages: string;
	dropImages: string;
	photoUploadError: string;
	photoUploadErrorCaption: string;
}

export interface SCity {
	title: string;
	events: string;
	price: string;
	register: string;
	soldOut: string;
	eventSessionsCount: string;
	buyTickets: string;
	scanQR: string;
	buyTicketsMobile: string;
	route: string;
	googleMaps: string;
	questionsAndAnswers: string;
	findTickets: string;
	freeOptions: string;
	free: string;
	buy: string;
	soon: string;
	closed: string;
	noTicketLeft: string;
	selectAnotherTime: string;
	selectTicket: string;
	enterDetails: string;
	mobileNumber: string;
	whatsApp: string;
	emergencyContactNumber: string;
	nationality: string;
	male: string;
	female: string;
	searchNationality: string;
	buttonMe: string;
	FieldsCaptions: FieldsCaptions;
	limitMessages: LimitMessages;
	FieldsLabels: FieldsLabels;
	marketingConsent: string;
	total: string;
	qr: string;
	left: string;
	person: string;
	reservedTime: string;
	statusConfirmBooking: string;
	statusCancelBooking: string;
	captionBooking: string;
	paymentsMethods: PaymentsMethods;
	debitCardDesc: string;
	chooseMethod: string;
	saveCard: string;
	addCard: string;
	placeOrder: string;
	goCheckout: string;
	conditionsAlert: string;
	termsConditions: string;
	emailTicketsTitle: string;
	emailTicketsCaption: string;
	addEmail: string;
	hasToBeFilled: string;
}

export interface FieldsCaptions {
	dateOfBirth: string;
	medicalHistory: string;
	clubTeam: string;
	tShirtSize: string;
}

export interface FieldsLabels {
	name: string;
	dateOfBirth: string;
	address: string;
	email: string;
	phone: string;
	whatsapp: string;
	emergencyContact: string;
	gender: string;
	nationality: string;
	emergencyContactPhone: string;
	clubTeam: string;
	qidPassport: string;
	marketingConsent: string;
	tShirtSize: string;
	medicalHistory: string;
}

export interface LimitMessages {
	sessionLimit: string;
	planLimit: string;
	stockLimit: string;
	sessionLimitWarning: string;
}

export interface PaymentsMethods {
	creditCard: string;
	debitCard: string;
	googlePay: string;
	applePay: string;
	ooredoo: string;
}

export interface ScheduleDelivery {
	date: string;
	time: string;
	confirm: string;
}

export interface Search {
	placeholder: string;
	seeAll: string;
	search: string;
	searchResults: string;
	nothingFound: string;
	nothingFoundHint: string;
	nothingFoundShort: string;
	nothingFoundInSubcategory: string;
	resultsIn: string;
	searchEverywhere: string;
	everyWhere: string;
	market: string;
}

export interface SiteMap {
	snoonu: string;
	socialMedia: string;
	downloadApp: string;
	snoonuBusiness: string;
	catalog: string;
	snooMap: string;
	detailsAndOffers: string;
	partners: string;
}

export interface SnooSim {
	heading: string;
	chooseCountry: string;
	choosePlan: string;
	getApp: string;
	buyESim: string;
}

export interface Subheader {
	market: string;
	grocery: string;
	restaurants: string;
	"s-city": string;
}

export interface TryAgain {
	title: string;
	cancel: string;
	tryAgain: string;
}

export interface SortBy {
	asc: string;
	dsc: string;
	sortBy: string;
	sort: string;
}

export interface SEO {
	url: string;
	title?: string;
	description: string;
	createdAt: Date;
	updatedAt: Date;
	locale: string;
}

export interface Query {
	source: string;
	slug: string;
}

export interface ScriptLoader {
	id?: string;
	strategy: string;
	children?: string;
	src?: string;
}
