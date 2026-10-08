// =====================================================================
// MGL Food Hub — master menu (transcribed from the 13 store menus).
// Every price here is FINAL. `npm run seed:generate` turns this file into
// supabase/migrations/20261007000300_seed_menu.sql.
//
// Syntax
//   STORE slug | Store Name | hub-category-slug | HH:MM-HH:MM
//   tagline: …   address: …   note: …         (optional store fields)
//   ## Section Name                            (optional ":: section note")
//   Product = <variants> [; @Group: A / B] [; #badge] [; ~description]
//   <variants> = "180"  (single price → variant "Regular")
//              | "Label 348 | Label 417.60"  (last number of each part = price)
//              | "Label 144 +24"             (+N = addon_price, e.g. extra toppings)
// =====================================================================

export const categories = [
  { slug: 'puto-kakanin', name: 'Puto & Kakanin' },
  { slug: 'pancit-bilao', name: 'Pancit & Bilao' },
  { slug: 'restaurants', name: 'Restaurants' },
  { slug: 'carinderia', name: 'Carinderia' },
  { slug: 'merienda-street-food', name: 'Merienda & Street Food' },
  { slug: 'diner', name: 'Diner' },
  { slug: 'sisig-crispy-favorites', name: 'Sisig & Crispy Favorites' },
]

export const menu = String.raw`
STORE hazels-special-puto | Hazel's Special Puto | puto-kakanin | 07:00-12:00
tagline: Freshly Steamed & Delicious!
## Mix
Mix = 10pcs 348.00 | 12pcs 417.60 | 20pcs 696.00 | 30pcs 1044.00
## Puto Pao
Puto Pao = 10pcs 360.00 | 12pcs 432.00 | 15pcs 540.00 | 20pcs 720.00 | 25pcs 900.00 | 30pcs 1080.00 | 50pcs 1800.00
## Puto
Puto = 10pcs 336.00 | 12pcs 403.20 | 15pcs 504.00 | 20pcs 696.00 | 25pcs 840.00 | 30pcs 1008.00 | 50pcs 1680.00

STORE aling-melys-carinderia | Aling Mely's Carinderia | carinderia | 09:00-21:00
## Ulam
Bangus sa Bayabas = Regular 156 | Large 168
Sarsiado Isda = Regular 144 | Large 168
Beef Steak = 180
Pangat = Regular 144 | Large 168
Sayote = 108
Togue = 96
Alamang = 96
Mga Gulay = 120
Adobo Pusit = 132
Relyenong Pusit = Small 120 | Medium 144 | Large 156 | Extra Large 180
Pritong Bangus = Regular 156 | Large 168
Totso = 168
Litson Kawali = 168
Paksiw na Pata = 300
Escabeche = Small 204 | Medium 300 | Large 360
Mechado = 204
Kaladereta = 216
Bola Sarsa = 180
Bola Sweet = 180
Tapa = 132
Bopis = 132
Tortang Alimasag = 132
Paksiw na Litson = 180
Menudo = 180
Tinumis = 132
Kare Kare = 192

STORE okoy-ni-jay-r | Okoy ni Jay R! | merienda-street-food | 07:30-20:00
tagline: Crispy on the outside, Loaded with Sarap inside! – Made with love para sa'yo!
note: For orders, message Jay R-D Original Okoy
## Okoy
Regular Okoy = 72 ; ~Mejo manipis at bilang lang ang hipon.
Regular Okoy w/ Tofu = 84 ; ~Togue't kalabasa, hipon at may add na tofu.
Veggies Okoy = 72 ; ~All veggies, togue't kalabasa, pwede din lagyan ng tofu.
Special Okoy = 120 ; #best_seller ; ~Dinoble, dinoble ang gulay esp. kalabasa at maraming hipon.
Super Special Okoy = 144 ; #best_seller ; ~Dinobleng togue't kalabasa, generous sa hipon at may added na tofu at onion rings!

STORE aurings-special-pancit-malabon | Auring's Special Pancit Malabon | pancit-bilao | 09:00-17:00
## Bilao
Pancit Malabon Bilao = For 4 persons 528.00 | For 5-6 persons 792.00 | For 8 persons 1056.00 | For 10 persons 1320.00 | For 12 persons 1560.00 | For 14 persons 1800.00 | For 16 persons 2100.00 | For 18 persons 2340.00 | For 20 persons 2580.00 | For 25 persons 3180.00 | For 30 persons 3600.00
## Styro
Pancit Malabon Styro = Small 180.00 | Medium 264.00 | Large 348.00
## Puto
Puto = 1 piece 33.60 | 1 box (10pcs) 336.00

STORE normas-special-pancit-bilao | Norma's Special Pancit Bilao | pancit-bilao | 09:00-18:00
## Pancit Bilao
Pancit Bilao = Size 8 (2-3 persons) 540 | Size 9 (3-4 persons) 660 | Size 10 (4-5 persons) 840 | Size 11 (5-6 persons) 960 | Size 12 (6-8 persons) 1080 | Size 13 (8-10 persons) 1200 | Size 14 (10-12 persons) 1440 | Size 15 (12-14 persons) 1680 | Size 16 (14-17 persons) 1920 | Size 17 (17-20 persons) 2160

STORE balsa-sa-niugan | Balsa sa Niugan | restaurants | 10:00-22:00
tagline: Floating Restaurant & Fishing Garden
address: #3 M. Aquino Street, Niugan, Malabon City
## Tilapia
Tilapia Sisig = 408
Sizzling w/ Spicy Veggies = 408
Steamed w/ Oyster & Garlic = 420
Steamed w/ Mayonnaise & Cheese = 456
Deep Fried w/ Garlic = 384
Grilled = 384
Pinaputok w/ Onion & Tomato = 456
Ginataang Tilapia = 456
## Tuna
Sizzling Panga = 456
Grilled Panga = 432
Sizzling Belly = 528
Grilled Belly = 528
Sinigang sa Miso = 588 ; @Cut: Belly / Panga
## Bangus (Boneless)
Sinigang Bangus Belly = 444
Sizzling Bangus Belly (4pcs.) = 432
Bangus Ala Pobre = 432
Bangus w/ Tomato & Onion Wrap = 468
Rellenong Bangus = 612
## Beef
Balsa Kare-Kare = 696
Beef Steak = 396
Beef Tapa = 384
Sizzling Beef in Chili Garlic Sauce = 456
Sizzling Beef Litid = 456
Sizzling Korean Beef = 612
Sinigang na Baka = 600
Nilagang Baka = 600
Sizzling T-Bone Steak (w/ Veg. Sidings) = 420
## Chicken
Balsa Chicken = Fried Whole 816 | Fried Half 552 | Buttered Whole 912
Sizzling Chicken w/ Gravy Sauce = 468
Sizzling Spicy Chicken w/ Chili Garlic Sauce = 468
Sizzling Spicy Chicken Feet = 384
Sizzling Buffalo Wings (4 pcs.) = 396
Sizzling Ajay Palabonalunan = 384
Chicken BBQ Legs = 300
## Pork
Sizzling Sisig = 444
Crispy Pata = 1200
Crispy Ulo = 1560
Pork Liempo BBQ = 456
Lechon Kawali = 456
Chicharon Bulaklak = 288
Sinigang na Liempo = 624
Nilagang Liempo = 624
## Vegetables
Ampalaya con Hipon = 456
Beef Ampalaya = 456
Chopsuey = 456
Pinakbet = 456
Vegetable Sticks w/ Mayo Dipping = 300
## Squid
Sizzling = 432
Grilled = 420
w/ Onions & Tomato Fillings = 480
Calamares = 456
Sizzling Japanese Ika = 456
Crispy Squid Head = 396
## Shrimp
Sizzling Spicy w/ Chili Garlic Sauce = 456
Sizzling Gambas = 420
Shrimp w/ Oyster Sauce = 420
Camaron Rebosado = 420
Talabos = 432
Sinigang na Hipon = 588
## Other Seafoods
Fish Fillet in Sweet & Sour = 408
Fried Fish Fillet = 336
Kilawin (Talaba) = 396
Deep Fried Salmon Head = 456
Sinigang sa Miso Salmon Head = 590
## Special Appetizers
Cheese Sticks = 180
Chili Cheese Bite = 264
Fish Shanghai Roll = 336
French Fries = 336
Lumpiang Shanghai = 336
Onion Rings = 300
Sliced Pipino = 240
Tokwa't Baboy = 180
Kutzing Sweet Corn = 180
Sizzling Hotdog = 456
Sizzling Sausage w/ Mushroom = 456
Sizzling Mushroom = 420
Sizzling Tofu w/ Special Chinese Sauce = 336
Sizzling Young Corn = 336
## Exotic Foods
Sizzling Adobong Kambing = 576
Sizzling Kalderetang Kambing = 576
Adobong Igat = 456
Sizzling Adobong Kabayo = 456
Tapa Kabayo = 384
Oyster Cake (Tortang Talaba) = 432
## Short Order
Pancit Bihon = 336
Pancit Canton = 336
Pancit Mixe & Bihon = 384
Sotanghon Guisado = 384
Lomi Special = 420
## Soup
Crab & Corn = 324
Chicken & Corn = 312
Mixed Oriental = 456
Cream of Mushroom = 456
## Rice
Pandan Rice = 42
Garlic Rice = 47
## Desserts
Fruits Salad Cup = 54
Fruit Salad Tub = 180
Leche Flan Royale Tub = 180
Halo-Halo = 144

STORE original-benjie-puto-pao | Original Benjie Puto Pao | puto-kakanin | 08:00-19:00
note: Prices are per piece
## Puto Pao :: Prices are per piece
Puto Pao = 33.60
Special Puto Pao = 42.00
Flavored Puto Pao = 36.00 ; @Flavor: Yema / Ube / Macapuno / Mocha
## Puto :: Prices are per piece
Puto = 28.80 ; @Type: Puto Keso / Puto Salted Egg / Plain

STORE raves-diner | Raves Diner | diner | 11:00-23:00
## Meals
Beef Belly = 251
Pork Belly = 251
Pork Ribs = 251
Bacon & Egg = 251
Chicken = 227
## Platter
Set A = 720
Set B = 960
Set C = 1320
## Sandwiches
Beef Belly = 215
Pork Belly = 215
Pulled Pork = 215
Bacon, Egg & Cheese = 215
## Pasta
Smoked Carbonara = Solo 191 | Sharing 474 | Feast 936 | Party 1440
Pesto w/ Smoked Bacon = Solo 227 | Sharing 510 | Feast 1020 | Party 1560
Shrimp Scampi = Solo 215 | Sharing 504 | Feast 984 | Party 1500
## Snacks
Smoked Nachos = 203
Smoked Fries = 203
Flavored Fries = 131
## Sides
Mac & Cheese = 102
Mashed Potato = 102
Potato Marble = 102
Coleslaw = 102
Creamed Corn = 102
## Sinigang
Pork Belly = 270
Pork Ribs = 270
Beef Belly = 306
All In (Pork Belly, Pork Ribs & Beef Belly) = 582
## Smoked Slabs
Pork Belly = 1kg 2040 | 500g 1050 | 250g 564
Pulled Pork = 1kg 2040 | 500g 1050 | 250g 564
Beef Belly = 1kg 2340 | 500g 1194 | 250g 630
Bacon = 1kg 1440 | 500g 720 | 250g 360
Spare Ribs = per rack 1860
Baby Back Ribs = per rack 1500
## Croffles
Classic = 102
Strawberry Goodness = 132
Mango Burst = 132
Oreo Bliss = 144
Butterscotch Treat = 144
Oh S'mores! = 144
Nutella Madness = 144
Ham & Cheese = 144
Ham & Lettuce = 144
Smoked Bacon & Cheese = 156
Oreo Nutella = 156
Matcha Dream = 156
Banatella = 156
## Drinks
Lemon Cucumber = 1.2L 162 | 650ml 90
Iced Tea (1.2L) = 108
Softdrink 1.5L = 108 ; @Flavor: Coke / Royal / Sprite
Softdrink 290ml = 34 ; @Flavor: Coke / Royal / Sprite / Mountain Dew
Del Monte Juice (in can) = 66
Bottled Water = 30

STORE mary-jay | Mary Jay | restaurants | 10:00-22:00
tagline: Since 1966
## Single Serving
Grilled Chicken w/ Sauce = 306
Quarter Fried Chicken = 288
Chicken Cutlets = 258
Burger Steak = 312
Lumpia Shanghai (6pcs) = 264
Asado = 264
Fish Fillet = 258
## Rice
Plain Rice = Cup 72 | Bowl 264
Fried Rice = Cup 90 | Bowl 330
Garlic Rice = Cup 84 | Bowl 330
Yang Chow Rice = Bowl 558
## Vegetables
Mixed Vegetables = 372
Chopsuey = 354 ; @Choice: Pork / Chicken
Ampalaya = 414 ; @Choice: Beef / Shrimp / Lechon
Garlic Broccoli = 504
## Noodles
Pancit Canton = 342 ; @Style: Toppings / Guisado
Pancit Bihon = 294
Pancit Miki Bihon = 294
Pancit Miki Guisado = 294
Sotanghon Guisado = 324
Crispy Canton w/ Chopseuy = 456
## Sizzling Plates
Gambas = 570
Pusit Ala Pobre = 558
Sisig = 438 ; @Choice: Pork / Bangus
Tanigue Steak = 660
Buttered Corn with Cheese = 306
Mushroom Buttons w/ Garlic = 306
Chicken Gravy = 546
Extra Gravy = 126
## Desserts
Ice Cream Cup = 72
Mais Con Yelo = 114
Maja Mais = 252
## Chicken
Mary Jay Fried Chicken = 444
Breaded Chicken Cutlets = 414
Spicy Chicken = 456
Buttered Chicken = 456
Garlic Chicken = 456
Hot & Spicy Chicken = 456
Chicken Curry = 528
## Beef
Shredded Beef w/ Mixed Vegetables = 540
Beef Tapa = 504
Bistik Tagalog = 504
Beef Caldereta = 540
Beef Broccoli = 540
Kare-kare = 702
Bulalo = 870
## Pork
Crispy Pata = 1272
Pata Tim = 1560
Pork Asado = 504
Halo Asado = 504
Lumpia Shanghai = 348
Liempo = 480
Lechon Macao = 522
Sweet & Sour Pork = 456
Sweet & Sour Meatballs = 456
Salt & Pepper Pork = 528
## Seafoods
Shrimp w/ Quail Egg = 528
Fish Fillet: Sweet & Sour = 480
Rellenong Bangus = 684
Lapu-Lapu = 204 ; @Style: Fried / Tausi / Sweet & Sour
Camaron Rebosado = 504
Tokwa = 504 ; @Choice: Shrimp / Fish
Rumble = 564
Daing na Bangus = 504
Mixed Seafoods = 792
Garlic Shrimp = 564
Garlic Squid = 564
Extra Garlic = 78
## Appetizers
Calamares Rings = 504
Cheese Sticks = 252
French Fries = 228
Squid Balls = 204
Fried Siomai = 204
Ensalada Pipino = 258
Caesar Salad = 504
## Mary Jay's Torta
Torta = 330 ; @Filling: Crab / Pork
Torta Shrimp = 366
## Beermates & Accompaniments
Kabayo = Tapa 444 | Adobo 456
Fried Tokwa = 222
Tokwa't Baboy = 354 ; @Choice: Pork / Tenga
Crispy Tenga = 402
Chicharon Bulaklak = 390
Dinakdakan = 456
Tuna Sashimi = 630
Kilawin Tanigue = 600
## Sandwiches
Mary Jay's Club Sandwich = 222
Toasted Bread & Butter = 78
Chicken Sandwich = 180
Ham & Chicken = 192
Ham & Egg = 192
Cheeseburger = 156
Hamburger = 126
Bacon Mushroom Melt Burger = 252
## Soup (8 to 10 persons)
Soup of the Day (single serving) = 102
Chicken Asparagus = 414
Quail Egg Soup = 396
Crab and Corn Soup = 366
Lomi = 354
Hototay = 354
Sinigang = Baboy 582 | Hipon/Isda 642
Bouillabaisse Soup = 606
## Beverages
Fresh Shake = 216 ; @Flavor: Mango / Banana
Fresh Buko Juice = 180
Sago't Gulaman = 90
Milo Dinosaur = 180
Iced Tea = Glass 90 | Pitcher 360
Juice = 102 ; @Flavor: Pineapple / Four Seasons / Mango
Fresh Calamansi Juice = 96
Hot Tea = 96
Soda in Can = 96
Soda (Pitcher) = 300
Iced Coffee = 102
Nescafe Coffee = 72
Nespresso Coffee = 174 ; @Type: Espresso / Lungo
Chocolate = 126 ; @Style: Hot / Iced
San Miguel Pale Pilsen = 108
San Miguel Lights = 108
San Miguel Apple = 108
Red Horse Beer = 108
Bottled Water = 42
## Liquors
Alfonso Light = 780
Fundador Light = 960
Black Label = 1800

STORE rody-days | Rody Day's | restaurants | 10:00-21:00
tagline: Good Food, Great Moments
## Fried
Crispy Pata = 1140
Crispy Ear = 228
Lechon Kawali = 228
Sweet & Sour Camaron = 228
Sweet & Sour Chuletas = 228
Sweet & Sour Meat Balls = 228
Sweet & Sour Pork (Choma) = 228
Sweet & Sour Fish Fillet = 228
Lumpiang Shanghai = 204
Calamares = 216
Camaron Rebusado = 216
Pinsec Frito = 228
Chuletas Frito = 216
Menudencia Frito = 216
## Fried Chicken
Fried Chicken = Whole 504 | 1/2 (Half) 264
## Breaded Chicken
Breaded Chicken = Whole 588 | 1/2 (Half) 378 | 1/4 (One Fourth) 228
## Buttered Chicken
Buttered Chicken = Whole 690 | 1/2 (Half) 384 | 1/4 (One Fourth) 290
## Additional Menu
Sinigang na Baboy = 336
Sinigang na Hipon = 336
Adobong Manok = 348
Adobong Baboy = 240
Beef Broccoli = 228
Beef Ampalaya = 228
Sisig = 276
Chinese Kikiam = 228
## Pancit Bilao
Bihon = 4-5 persons 756 | 6-7 persons 1056 | 8-9 persons 1404 | 10-12 persons 1656
Miki Bihon = 4-5 persons 756 | 6-7 persons 1056 | 8-9 persons 1404 | 10-12 persons 1656
Canton = 4-5 persons 924 | 6-7 persons 1176 | 8-9 persons 1512 | 10-12 persons 1728

STORE anny-dading-peachy-peachy | Anny ♥ Dading Peachy-Peachy | puto-kakanin | 06:00-20:00
tagline: Pighta • Sarap • Pamilya
note: Pricelist effective April 2, 2026
## Peachy-Peachy Boxes :: Tick "Add Extra Toppings" for more cheese or coconut.
Peachy-Peachy = Small 10 pcs 144 +24 | Small 12 pcs 174 +24 | Medium 15 pcs 216 +42 | Medium 20 pcs 288 +42 | Large 25 pcs 360 +48 | Large 30 pcs 432 +48 | Extra Large 40 pcs 576 +72 | Extra Large 50 pcs 720 +72 ; @Topping: Cheese / Coconut

STORE judy-anns-crispy-pata | Judy Ann's Crispy Pata | restaurants | 10:00-22:00
tagline: Good Food Brings People Together
## Crispy Pata
Crispy Pata = Regular 1188 | Jumbo 1308
## Pork
Lechon Macau = 378
Lumpiang Shanghai = 350
Sweet & Sour Bola-Bola = 378
Sweet & Sour Pork = 378
Torta Pork = 350 ; #best_seller
Pork Asado = 354 ; #best_seller
## Chicken
Whole Fried Chicken = 834
Half Fried Chicken = 420
Chicken Wings (6pcs) = 354
Chicken Sisig = 354 ; #best_seller
## Vegetables
Chop Suey = 378 ; #best_seller
Ampalaya con Carne = 378
Ampalaya con Hipon = 378 ; #best_seller
## Seafood
Sizzling Gambas (6pcs) = 426 ; #best_seller
Shrimp Embotido (6pcs) = 390 ; #best_seller
Camaron Rebusado = 378
Sweet & Sour Camaron = 390
Torta with Shrimp = 390
Torta with Alimasag = 390 ; #best_seller
Calamares = 390
Breaded Fish Fillet (6pcs) = 330
Sweet & Sour Fish Fillet = 330
Fish Fillet with Tofu & Tausi = 390 ; #best_seller
## Filipino Favorites
Judy Ann's Kare-Kare – Goto = 632
Lechon Kare-Kare = 672 ; #best_seller
Judy Ann's Kare-Kare – Mix = 768
Sinigang na Baboy = 546
Pork Sisig (6pcs) = 462
Bistek Tagalog = 546
Beef with Mushroom = 462 ; #best_seller
Beef Broccoli = 462
Chicharon Bulaklak = 306 ; #best_seller
## Noodles
Fried Canton = 318 ; #best_seller
Canton (6pcs) = 318
Canton Bilao = 4 pax 546 | 6 pax 756 | 8 pax 1050 | 10 pax 1260
Bihon Bilao = 4 pax 468 | 6 pax 744 | 8 pax 936 | 10 pax 1170
Miki-Bihon Bilao = 4 pax 468 | 6 pax 744 | 8 pax 936 | 10 pax 1170
## Soup
Hototay = 378 ; #best_seller
Nido = 354
Crab & Corn = 318
Lomi = 318
## Rice
Judy Ann's Fried Rice (Platter) = 420
Fried Rice (Platter) = 315
Garlic Rice = Platter 318 | Cup 70
Plain Rice = Platter 188 | Cup 55
## Drinks
Coke = 114
Coke Zero = 114
Royal = 114
Mountain Dew = 114
Sprite = 114
Pineapple Ace = 114
Pineapple Four Seasons = 114
Bottled Water = 53
House Blend Iced Tea = Glass 98 | Pitcher 295
Red Tea = Glass 70 | Pitcher 268
Cucumber Lemonade = Glass 105 | Pitcher 315
San Miguel Light = 105
San Miguel Pale Pilsen = 105

STORE sisig-ni-mutik | Sisig ni Mutik | sisig-crispy-favorites | 10:00-21:00
tagline: Crispy • Saucy • Yummy
## Crispy Sisig
Crispy Sisig = Regular 114 | Large 144 | Barkada 264
## Crispy Bagnet
Crispy Bagnet = Regular 150 | Barkada 420
## Rice Meals & Shanghai
Sisig with Rice = 84
Shanghai w/ Rice = 78
Shanghai Regular = 144
## Bilao
Sisig Bilao = 732
Mix Bilao = 756
Bagnet Bilao = 828
Bilao Shanghai = 624
## Crispy Pata
Crispy Pata = Regular 468 | Medium 492 | Large 516 ; #new
`

// Balsa Chicken — "Buttered Half" is unreadable on the menu photo (₱[CONFIRM]).
// It is intentionally NOT seeded. Once confirmed, run (replace 000):
//   insert into product_variants (product_id, label, price, sort)
//   select id, 'Buttered Half', 000, 4 from products
//   where name = 'Balsa Chicken' and store_id = (select id from stores where slug = 'balsa-sa-niugan');
