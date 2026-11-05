import { createHash } from "node:crypto";

export const stableId = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
export const outlets = [
  ["The Washington Post", "https://feeds.washingtonpost.com/rss/politics"],
  ["The New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"],
  ["Axios", "https://api.axios.com/feed/"],
  ["CBS", "https://www.cbsnews.com/latest/rss/politics"],
  ["The Atlantic", "https://www.theatlantic.com/feed/all/"],
  ["The Wall Street Journal", "https://feeds.content.dowjones.io/public/rss/RSSWorldNews"],
  ["Reuters", ""],
  ["ABC", "https://abcnews.go.com/abcnews/politicsheadlines"],
  ["CNN", "https://rss.cnn.com/rss/cnn_allpolitics.rss"],
  ["Washington Examiner", "https://www.washingtonexaminer.com/feed/"],
  ["Daily Mail", "https://www.dailymail.co.uk/news/us-politics/index.rss"],
  ["NBC", "https://feeds.nbcnews.com/nbcnews/public/politics"],
] as const;

// User-defined monitoring roster; affiliations reflect the requested scope.
export const journalistRoster = [
  ["Axios", ["Marc Caputo", "Alex Isenstadt", "Tom Novelly", "Barak Ravid"]],
  ["The Washington Post", ["Tara Copp", "Noah Robertson", "Dan Lamothe", "Alex Horton"]],
  ["The New York Times", ["Greg Jaffe", "Eric Schmitt", "Helene Cooper", "Julian Barnes"]],
  ["The Wall Street Journal", ["Michael Gordon", "Lara Seligman", "Alex Ward", "Heather Somerville"]],
  ["The Atlantic", ["Nancy Youssef", "Missy Ryan", "Johnathan Lemiere"]],
  ["CBS", ["Eleanor Watson", "Jim Laporta", "Jennifer Jacobs", "Emma Nicholson"]],
  ["NBC", ["Courtney Kube", "Gordon Lubold", "Moshes Gaines", "Ken Dilanian"]],
] as const;

// User-supplied research scope, not independently verified office-holder facts.
export const people = [
  ["Donald Trump", 1, "Trump"], ["Pete Hegseth", 1, "Hegseth"],
  ["Gen. Dan Caine", 1, "Dan Caine|Caine"], ["Adm. Brad Cooper", 1, "Brad Cooper"],
  ["JD Vance", 2, "Vance|J.D. Vance"], ["Marco Rubio", 2, "Rubio"],
  ["Steve Witkoff", 2, "Witkoff"], ["Jared Kushner", 2, "Kushner"],
  ["Benjamin Netanyahu", 2, "Netanyahu"], ["Stephen Feinberg", 2, "Feinberg"],
  ["Elbridge Colby", 2, "Colby"], ["Lt. Gen. Brett Sylvia", 3, "Brett Sylvia"],
  ["Adam Telle", 3, "Telle"], ["Sean Parnell", 3, "Parnell"], ["Anna Kelly", 3, "Anna Kelly"],
  ...["Hakeem Jeffries", "Mike Johnson", "Thom Tillis", "Thomas Massie", "Mark Kelly", "Shri Thanedar", "Yassamin Ansari", "Suhas Subramanyam", "Melanie Stansbury"].map(n => [n, 3, n]),
] as [string, number, string][];
export const organizations = [
  ["White House", 1, "Executive Office of the President|presidential advisers"],
  ["Department of War / Department of Defense", 1, "Pentagon|Department of Defense|Department of War|Office of the Secretary of War|Secretary of Defense"],
  ["Joint Staff", 1, "Joint Chiefs of Staff|Joint Chiefs|Chairman of the Joint Chiefs|Vice Chairman|J3 Operations|J5 Strategy"],
  ["U.S. Central Command", 1, "CENTCOM|Fifth Fleet|Air Forces Central|Joint Force"],
  ["National Security Council", 2, "National Security Adviser|Deputy National Security Adviser"],
  ["Department of State", 2, "State Department|Secretary of State"],
  ["Intelligence Community", 3, "CIA|DIA|Director of National Intelligence|Joint Staff J2"],
  ["Congressional oversight", 3, "Armed Services Committee|defense appropriations|inspector general|DOJ|military investigations"],
  ["Israeli strategic actors", 2, "Israeli Prime Minister|Israel Defense Forces|Israeli Ministry of Defense"],
  ["Iranian leadership", 2, "Iran leadership|Iranian military|Iran national security"],
  ["National / Defense Industrial Base", 3, "defense industrial base|munitions|sustainment"],
] as [string, number, string][];
export const attributions = [
  "senior administration official", "White House aide", "presidential adviser", "outside adviser to Trump",
  "person familiar with the President's thinking", "person familiar with personnel discussions",
  "senior defense official", "military adviser", "Joint Staff official", "senior military officer", "retired general",
  "officer familiar with war planning", "person briefed on military options", "intelligence official",
  "person familiar with intelligence assessments", "official briefed on classified assessments", "national security official",
  "congressional aide", "Armed Services Committee staffer", "Pentagon whistleblower",
  "official familiar with internal investigations", "Israeli defense official", "Israeli security official",
  "regional diplomat", "Gulf official", "official familiar with U.S.–Israel consultations",
];
export const topics = ["Politics", "Geopolitics", "Foreign Policy", "Defense Policy", "Intelligence", "Defense", "Military Operations", "Defense Industrial Base"];
