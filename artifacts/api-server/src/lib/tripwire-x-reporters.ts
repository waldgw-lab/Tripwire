/** User-approved reporter shortlist. These are explicit watches, not account discovery. */
export const X_REPORTERS = [
  ["Axios", "BarakRavid", "Barak Ravid"],
  ["Axios", "MarcACaputo", "Marc Caputo"],
  ["Axios", "axiosalex", "Alex Isenstadt"],
  ["Axios", "TomNovelly", "Thomas Novelly"],
  ["The Washington Post", "DanLamothe", "Dan Lamothe"],
  ["The Washington Post", "TaraCopp", "Tara Copp"],
  ["The Washington Post", "AlexHortonTX", "Alex Horton"],
  ["The Washington Post", "noahjrobertson", "Noah Robertson"],
  ["The New York Times", "EricSchmittNYT", "Eric Schmitt"],
  ["The New York Times", "julianbarnes", "Julian E. Barnes"],
  ["The New York Times", "gregjaffe", "Greg Jaffe"],
  ["The Wall Street Journal", "laraseligman", "Lara Seligman"],
  ["The Wall Street Journal", "alexbward", "Alexander Ward"],
  ["The Wall Street Journal", "mgordonwsj", "Michael R. Gordon"],
  ["The Atlantic", "nancyayoussef", "Nancy A. Youssef"],
  ["The Atlantic", "missy_ryan", "Missy Ryan"],
  ["The Atlantic", "JonLemire", "Jonathan Lemire"],
  ["CNN", "NatashaBertrand", "Natasha Bertrand"],
  ["CNN", "halbritz", "Haley Britzky"],
  ["CNN", "ZcohenCNN", "Zachary Cohen"],
  ["Reuters", "phildstewart", "Phil Stewart"],
  ["Reuters", "idreesali114", "Idrees Ali"],
  ["CBS", "ellee_watson", "Eleanor Watson"],
  ["CBS", "JimLaPorta", "James LaPorta"],
  ["CBS", "JenniferJJacobs", "Jennifer Jacobs"],
  ["NBC", "ckubeNBC", "Courtney Kube"],
  ["NBC", "glubold", "Gordon Lubold"],
  ["ABC", "LMartinezABC", "Luis Martinez"],
] as const;

// Explicit same-person mappings to the existing user-supplied journalist roster.
// Never use fuzzy name matching to join people or transfer article credits.
export const REPORTER_ALIASES: Record<string, string[]> = {
  tomnovelly: ["Tom Novelly"],
  julianbarnes: ["Julian Barnes"],
  mgordonwsj: ["Michael Gordon"],
  alexbward: ["Alex Ward"],
  nancyayoussef: ["Nancy Youssef"],
  jonlemire: ["Johnathan Lemiere"],
  jimlaporta: ["Jim LaPorta"],
};

/** Public publisher-bio portraits, reviewed separately from news/story images.
 * URLs are rendered directly; no image bytes or signed private objects are stored.
 * Missing portraits use initials until supplied or resolved through approved X access.
 */
export const REPORTER_PORTRAITS: Record<string, { url: string; source: string }> = {
  barakravid: {
    url: "https://images.axios.com/-2sUPMInOxTPn5qQ9BT_yB7m6Qc=/328x0/smart/2023/10/25/1698233257296.jpg",
    source: "https://www.axios.com/authors/Barak_Ravid",
  },
  axiosalex: {
    url: "https://images.axios.com/YVGywIBFpYJ0r9aLmxTJc_kUuD0=/328x0/smart/2026/07/27/1785120525610.jpg",
    source: "https://www.axios.com/authors/alex.isenstadt",
  },
  alexbward: {
    url: "https://images.wsj.net/im-35117472?width=80&size=1&pixel_ratio=2",
    source: "https://www.wsj.com/news/author/alexander-ward",
  },
  halbritz: {
    url: "https://media.cnn.com/api/v1/images/stellar/prod/britzky2560x1440.jpeg?c=16x9&q=h_160,w_160,c_fill",
    source: "https://www.cnn.com/profiles/haley-britzky",
  },
  zcohencnn: {
    url: "https://media.cnn.com/api/v1/images/stellar/prod/1418603-1130-r-ps2560x1440.jpg?c=16x9&q=h_160,w_160,c_fill",
    source: "https://www.cnn.com/profiles/zachary-cohen-profile",
  },
  phildstewart: {
    url: "https://s3.amazonaws.com/arc-authors/reuters/81a8ef9d-23ec-43d9-8fc9-ac039da9e59c.jpg",
    source: "https://www.reuters.com/authors/phil-stewart/",
  },
  idreesali114: {
    url: "https://author-service-images-prod-us-east-1.publishing.aws.arc.pub/reuters/0f22192f-a82f-4f9c-bdf3-54cfe1d6a4dd.jpg",
    source: "https://www.reuters.com/authors/idrees-ali/",
  },
  jimlaporta: {
    url: "https://assets1.cbsnewsstatic.com/hub/i/2026/10/28/3ea867eb-3855-492d-8eae-ac93935bdf4c/1793226730564-1.jpg",
    source: "https://www.cbsnews.com/team/james-laporta/",
  },
  jenniferjjacobs: {
    url: "https://assets1.cbsnewsstatic.com/hub/i/2025/10/08/b56749c8-5bed-4be2-9de9-1fd8c5d3faae/headshot-600-jennifer-jacobs.jpg",
    source: "https://www.cbsnews.com/team/jennifer-jacobs/",
  },
};
