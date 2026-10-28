"""Fêtes des prénoms (calendrier français usuel, celui des almanachs) : « Bonne fête aux Quentin »,
et la date de fête d'un contact d'après son prénom."""

import unicodedata
from datetime import date

# MM-JJ : prénoms fêtés ce jour (le premier sert d'intitulé)
FETES = {
    "01-01": ["Marie"], "01-02": ["Basile"], "01-03": ["Geneviève"], "01-04": ["Odilon"], "01-05": ["Édouard"], "01-06": ["Mélaine"],
    "01-07": ["Raymond"], "01-08": ["Lucien"], "01-09": ["Alix"], "01-10": ["Guillaume"], "01-11": ["Paulin"], "01-12": ["Tatiana"],
    "01-13": ["Yvette"], "01-14": ["Nina"], "01-15": ["Rémi"], "01-16": ["Marcel"], "01-17": ["Roseline", "Antoine"], "01-18": ["Prisca"],
    "01-19": ["Marius"], "01-20": ["Sébastien"], "01-21": ["Agnès"], "01-22": ["Vincent"], "01-23": ["Barnard"], "01-24": ["François de Sales"],
    "01-25": ["Conversion de Paul"], "01-26": ["Paule"], "01-27": ["Angèle"], "01-28": ["Thomas d'Aquin"], "01-29": ["Gildas"], "01-30": ["Martine"],
    "01-31": ["Marcelle"],
    "02-01": ["Ella"], "02-02": ["Théophane"], "02-03": ["Blaise"], "02-04": ["Véronique"], "02-05": ["Agathe"], "02-06": ["Gaston"],
    "02-07": ["Eugénie"], "02-08": ["Jacqueline"], "02-09": ["Apolline"], "02-10": ["Arnaud"], "02-11": ["Notre-Dame de Lourdes"], "02-12": ["Félix"],
    "02-13": ["Béatrice"], "02-14": ["Valentin"], "02-15": ["Claude"], "02-16": ["Julienne"], "02-17": ["Alexis"], "02-18": ["Bernadette"],
    "02-19": ["Gabin"], "02-20": ["Aimée"], "02-21": ["Pierre Damien"], "02-22": ["Isabelle"], "02-23": ["Lazare"], "02-24": ["Modeste"],
    "02-25": ["Roméo"], "02-26": ["Nestor"], "02-27": ["Honorine"], "02-28": ["Romain"], "02-29": ["Auguste"],
    "03-01": ["Aubin"], "03-02": ["Charles le Bon"], "03-03": ["Guénolé"], "03-04": ["Casimir"], "03-05": ["Olive"], "03-06": ["Colette"],
    "03-07": ["Félicité"], "03-08": ["Jean de Dieu"], "03-09": ["Françoise"], "03-10": ["Vivien"], "03-11": ["Rosine"], "03-12": ["Justine"],
    "03-13": ["Rodrigue"], "03-14": ["Mathilde"], "03-15": ["Louise"], "03-16": ["Bénédicte"], "03-17": ["Patrice", "Patrick"], "03-18": ["Cyrille"],
    "03-19": ["Joseph"], "03-20": ["Herbert"], "03-21": ["Clémence"], "03-22": ["Léa"], "03-23": ["Victorien"], "03-24": ["Catherine de Suède"],
    "03-25": ["Humbert"], "03-26": ["Larissa"], "03-27": ["Habib"], "03-28": ["Gontran"], "03-29": ["Gwladys"], "03-30": ["Amédée"],
    "03-31": ["Benjamin"],
    "04-01": ["Hugues", "Hugo"], "04-02": ["Sandrine"], "04-03": ["Richard"], "04-04": ["Isidore"], "04-05": ["Irène"], "04-06": ["Marcellin"],
    "04-07": ["Jean-Baptiste de la Salle"], "04-08": ["Julie"], "04-09": ["Gautier"], "04-10": ["Fulbert"], "04-11": ["Stanislas"], "04-12": ["Jules"],
    "04-13": ["Ida"], "04-14": ["Maxime"], "04-15": ["Paterne"], "04-16": ["Benoît-Joseph"], "04-17": ["Anicet"], "04-18": ["Parfait"],
    "04-19": ["Emma"], "04-20": ["Odette"], "04-21": ["Anselme"], "04-22": ["Alexandre"], "04-23": ["Georges"], "04-24": ["Fidèle"],
    "04-25": ["Marc"], "04-26": ["Alida"], "04-27": ["Zita"], "04-28": ["Valérie"], "04-29": ["Catherine de Sienne"], "04-30": ["Robert"],
    "05-01": ["Jérémie"], "05-02": ["Boris", "Zoé"], "05-03": ["Philippe", "Jacques"], "05-04": ["Sylvain"], "05-05": ["Judith"], "05-06": ["Prudence"],
    "05-07": ["Gisèle"], "05-08": ["Désiré"], "05-09": ["Pacôme"], "05-10": ["Solange"], "05-11": ["Estelle"], "05-12": ["Achille"],
    "05-13": ["Rolande"], "05-14": ["Matthias", "Mathis"], "05-15": ["Denise"], "05-16": ["Honoré"], "05-17": ["Pascal"], "05-18": ["Éric"],
    "05-19": ["Yves"], "05-20": ["Bernardin"], "05-21": ["Constantin"], "05-22": ["Émile", "Rita"], "05-23": ["Didier"], "05-24": ["Donatien"],
    "05-25": ["Sophie"], "05-26": ["Bérenger"], "05-27": ["Augustin de Cantorbéry"], "05-28": ["Germain"], "05-29": ["Aymar"], "05-30": ["Ferdinand", "Jeanne"],
    "05-31": ["Perrine"],
    "06-01": ["Justin"], "06-02": ["Blandine"], "06-03": ["Kévin"], "06-04": ["Clotilde"], "06-05": ["Igor"], "06-06": ["Norbert"],
    "06-07": ["Gilbert"], "06-08": ["Médard"], "06-09": ["Diane"], "06-10": ["Landry"], "06-11": ["Barnabé"], "06-12": ["Guy"],
    "06-13": ["Antoine de Padoue"], "06-14": ["Élisée"], "06-15": ["Germaine"], "06-16": ["Jean-François Régis"], "06-17": ["Hervé"], "06-18": ["Léonce"],
    "06-19": ["Romuald"], "06-20": ["Silvère"], "06-21": ["Rodolphe"], "06-22": ["Alban"], "06-23": ["Audrey"], "06-24": ["Jean-Baptiste"],
    "06-25": ["Prosper"], "06-26": ["Anthelme"], "06-27": ["Fernand"], "06-28": ["Irénée"], "06-29": ["Pierre", "Paul"], "06-30": ["Martial"],
    "07-01": ["Thierry"], "07-02": ["Martinien"], "07-03": ["Thomas", "Tom"], "07-04": ["Florent"], "07-05": ["Antoine-Marie"], "07-06": ["Mariette"],
    "07-07": ["Raoul"], "07-08": ["Thibaut"], "07-09": ["Amandine"], "07-10": ["Ulrich"], "07-11": ["Benoît"], "07-12": ["Olivier"],
    "07-13": ["Henri", "Joël"], "07-14": ["Camille"], "07-15": ["Donald"], "07-16": ["Carmen"], "07-17": ["Charlotte"], "07-18": ["Frédéric"],
    "07-19": ["Arsène"], "07-20": ["Marina"], "07-21": ["Victor"], "07-22": ["Marie-Madeleine", "Madeleine"], "07-23": ["Brigitte"], "07-24": ["Christine"],
    "07-25": ["Jacques le Majeur", "Christophe"], "07-26": ["Anne", "Joachim"], "07-27": ["Nathalie"], "07-28": ["Samson"], "07-29": ["Marthe"], "07-30": ["Juliette"],
    "07-31": ["Ignace"],
    "08-01": ["Alphonse"], "08-02": ["Julien Eymard"], "08-03": ["Lydie"], "08-04": ["Jean-Marie Vianney"], "08-05": ["Abel"], "08-06": ["Octavien"],
    "08-07": ["Gaëtan"], "08-08": ["Dominique"], "08-09": ["Amour"], "08-10": ["Laurent"], "08-11": ["Claire"], "08-12": ["Clarisse"],
    "08-13": ["Hippolyte"], "08-14": ["Evrard"], "08-15": ["Marie (Assomption)"], "08-16": ["Armel"], "08-17": ["Hyacinthe"], "08-18": ["Hélène"],
    "08-19": ["Jean-Eudes"], "08-20": ["Bernard"], "08-21": ["Christophe"], "08-22": ["Fabrice"], "08-23": ["Rose"], "08-24": ["Barthélemy"],
    "08-25": ["Louis"], "08-26": ["Natacha"], "08-27": ["Monique"], "08-28": ["Augustin"], "08-29": ["Sabine"], "08-30": ["Fiacre"],
    "08-31": ["Aristide"],
    "09-01": ["Gilles"], "09-02": ["Ingrid"], "09-03": ["Grégoire"], "09-04": ["Rosalie"], "09-05": ["Raïssa"], "09-06": ["Bertrand"],
    "09-07": ["Reine"], "09-08": ["Adrien"], "09-09": ["Alain"], "09-10": ["Inès"], "09-11": ["Adelphe"], "09-12": ["Apollinaire"],
    "09-13": ["Aimé"], "09-14": ["Croix glorieuse"], "09-15": ["Roland"], "09-16": ["Édith"], "09-17": ["Renaud"], "09-18": ["Nadège"],
    "09-19": ["Émilie"], "09-20": ["Davy"], "09-21": ["Matthieu", "Mathéo"], "09-22": ["Maurice"], "09-23": ["Constant"], "09-24": ["Thècle"],
    "09-25": ["Hermann"], "09-26": ["Côme", "Damien"], "09-27": ["Vincent de Paul"], "09-28": ["Venceslas"], "09-29": ["Michel", "Gabriel", "Raphaël"],
    "09-30": ["Jérôme"],
    "10-01": ["Thérèse de l'Enfant-Jésus"], "10-02": ["Léger"], "10-03": ["Gérard"], "10-04": ["François"], "10-05": ["Fleur"], "10-06": ["Bruno"],
    "10-07": ["Serge"], "10-08": ["Pélagie"], "10-09": ["Denis", "Sarah"], "10-10": ["Ghislain"], "10-11": ["Firmin"], "10-12": ["Wilfried"],
    "10-13": ["Géraud"], "10-14": ["Juste"], "10-15": ["Thérèse"], "10-16": ["Edwige"], "10-17": ["Baudouin"], "10-18": ["Luc", "Lucas"],
    "10-19": ["René"], "10-20": ["Adeline"], "10-21": ["Céline"], "10-22": ["Élodie"], "10-23": ["Jean de Capistran"], "10-24": ["Florentin"],
    "10-25": ["Crépin"], "10-26": ["Dimitri"], "10-27": ["Émeline"], "10-28": ["Simon", "Jude"], "10-29": ["Narcisse"], "10-30": ["Bienvenue"],
    "10-31": ["Quentin"],
    "11-01": ["Toussaint"], "11-02": ["Défunts"], "11-03": ["Hubert"], "11-04": ["Charles"], "11-05": ["Sylvie"], "11-06": ["Bertille"],
    "11-07": ["Carine"], "11-08": ["Geoffroy"], "11-09": ["Théodore"], "11-10": ["Léon", "Léo"], "11-11": ["Martin"], "11-12": ["Christian"],
    "11-13": ["Brice"], "11-14": ["Sidoine"], "11-15": ["Albert", "Arthur"], "11-16": ["Marguerite"], "11-17": ["Élisabeth"], "11-18": ["Aude"],
    "11-19": ["Tanguy"], "11-20": ["Edmond"], "11-21": ["Présentation de Marie"], "11-22": ["Cécile"], "11-23": ["Clément"], "11-24": ["Flora"],
    "11-25": ["Catherine"], "11-26": ["Delphine"], "11-27": ["Séverin"], "11-28": ["Jacques de la Marche"], "11-29": ["Saturnin"], "11-30": ["André"],
    "12-01": ["Florence"], "12-02": ["Viviane"], "12-03": ["François-Xavier"], "12-04": ["Barbara"], "12-05": ["Gérald"], "12-06": ["Nicolas"],
    "12-07": ["Ambroise"], "12-08": ["Immaculée Conception"], "12-09": ["Pierre Fourier"], "12-10": ["Romaric"], "12-11": ["Daniel"], "12-12": ["Jeanne-Françoise de Chantal"],
    "12-13": ["Lucie"], "12-14": ["Odile"], "12-15": ["Ninon"], "12-16": ["Alice"], "12-17": ["Gaël"], "12-18": ["Gatien"],
    "12-19": ["Urbain"], "12-20": ["Théophile"], "12-21": ["Pierre Canisius"], "12-22": ["Françoise-Xavière"], "12-23": ["Armand"], "12-24": ["Adèle", "Adam", "Ève"],
    "12-25": ["Noël", "Emmanuel"], "12-26": ["Étienne"], "12-27": ["Jean"], "12-28": ["Innocents"], "12-29": ["David"], "12-30": ["Roger"],
    "12-31": ["Sylvestre"],
}
# Prénoms courants rattachés à la fête d'un saint (formes dérivées)
ALIASES = {
    "manon": "08-15", "marion": "08-15", "maryse": "08-15", "maria": "08-15", "mariana": "08-15", "maelle": "08-15", "mael": "05-24",
    "anais": "07-26", "anna": "07-26", "annie": "07-26", "nina": "01-14", "jean": "12-27", "jeanne": "05-30", "johan": "12-27", "yann": "12-27",
    "pierre": "06-29", "paul": "06-29", "paula": "01-26", "pauline": "01-26", "jules": "04-12", "julien": "08-02", "juliette": "07-30",
    "mathilde": "03-14", "mathis": "05-14", "matheo": "09-21", "matteo": "09-21", "noa": "12-25", "noah": "12-25", "noemie": "08-15",
    "gabriel": "09-29", "gabrielle": "09-29", "raphael": "09-29", "raphaelle": "09-29", "michel": "09-29", "michele": "09-29", "louis": "08-25",
    "louise": "03-15", "lou": "03-15", "lucas": "10-18", "luc": "10-18", "luca": "10-18", "leo": "11-10", "leon": "11-10", "leonie": "11-10",
    "hugo": "04-01", "hugues": "04-01", "thomas": "07-03", "tom": "07-03", "theo": "11-09", "theodore": "11-09", "clement": "11-23",
    "clementine": "11-23", "clemence": "03-21", "chloe": "02-24", "camille": "07-14", "zoe": "05-02", "rose": "08-23", "rosalie": "09-04",
    "sarah": "10-09", "sara": "10-09", "ines": "09-10", "agnes": "01-21", "alice": "12-16", "eva": "12-24", "eve": "12-24", "adam": "12-24",
    "antoine": "06-13", "antonin": "05-02", "nicolas": "12-06", "colin": "12-06", "alexandre": "04-22", "alexis": "02-17", "alexandra": "04-22",
    "francois": "10-04", "francoise": "03-09", "fanny": "03-09", "frank": "10-04", "franck": "10-04", "christophe": "08-21", "chris": "08-21",
    "christine": "07-24", "christelle": "07-24", "elisabeth": "11-17", "elise": "11-17", "isabelle": "02-22", "babette": "11-17", "lisa": "11-17",
    "emilie": "09-19", "emile": "05-22", "emilien": "11-12", "jeremy": "05-01", "jeremie": "05-01", "kevin": "06-03", "ethan": "07-21",
    "victor": "07-21", "victoria": "11-17", "valentin": "02-14", "valentine": "07-25", "julie": "04-08", "julia": "04-08", "juline": "04-08",
    "lea": "03-22", "leane": "03-22", "lena": "08-18", "helene": "08-18", "eleonore": "06-25", "elena": "08-18", "margaux": "11-16", "margot": "11-16",
    "marguerite": "11-16", "maelys": "08-15", "laura": "10-19", "laure": "08-10", "lauriane": "08-10",
    "laurent": "08-10", "sacha": "04-22", "sasha": "04-22", "baptiste": "06-24", "jean-baptiste": "06-24", "benjamin": "03-31", "arthur": "11-15",
    "maxime": "04-14", "max": "04-14", "romain": "02-28", "quentin": "10-31", "valentina": "02-14", "nathalie": "07-27", "natacha": "08-26",
    "sebastien": "01-20", "stephane": "12-26", "stephanie": "12-26", "etienne": "12-26", "guillaume": "01-10", "william": "01-10",
    "anthony": "06-13", "tony": "06-13", "cedric": "01-07", "remi": "01-15", "remy": "01-15", "jerome": "09-30",
    "olivier": "07-12", "olivia": "03-05", "david": "12-29", "daniel": "12-11", "danielle": "12-11", "patrick": "03-17", "patrice": "03-17",
    "philippe": "05-03", "jacques": "05-03", "james": "05-03", "henri": "07-13", "henry": "07-13", "joel": "07-13", "claude": "02-15",
    "claudine": "02-15", "claire": "08-11", "clara": "08-11", "sophie": "05-25", "sofia": "05-25", "celine": "10-21", "marie": "08-15",
    "melanie": "12-31", "aurelie": "10-15", "audrey": "06-23", "sandrine": "04-02", "sandra": "04-02", "carole": "07-17", "caroline": "07-17",
    "charlotte": "07-17", "charles": "11-04", "charlie": "11-04", "lucie": "12-13", "lucien": "01-08", "louna": "08-15", "timothee": "01-26", "elias": "07-20", "eliott": "07-20", "elliot": "07-20", "gael": "12-17", "gaelle": "12-17", "morgane": "10-08",
    "emma": "04-19", "adrien": "09-08", "adrienne": "09-08", "martin": "11-11", "martine": "01-30",
    "valerie": "04-28", "virginie": "01-07", "veronique": "02-04", "vincent": "01-22", "sylvie": "11-05", "sylvain": "05-04", "dominique": "08-08",
    "gerard": "10-03", "bernard": "08-20", "serge": "10-07", "andre": "11-30", "andrea": "11-30", "joseph": "03-19", "josephine": "03-19",
    "jose": "03-19", "josiane": "03-19", "nadia": "09-17", "nadege": "09-18", "monique": "08-27", "jacqueline": "02-08", "brigitte": "07-23",
    "catherine": "11-25", "cathy": "11-25", "karine": "11-07", "carine": "11-07", "fabrice": "08-22", "fabienne": "01-20", "frederic": "07-18",
    "frederique": "07-18", "thierry": "07-01", "eric": "05-18", "erica": "05-18", "yves": "05-19", "yvette": "01-13", "yvonne": "05-19",
    "denis": "10-09", "denise": "05-15", "pascal": "05-17", "pascale": "05-17", "didier": "05-23", "alain": "09-09", "renee": "10-19",
    "rene": "10-19", "georges": "04-23", "robert": "04-30", "roger": "12-30", "christian": "11-12", "christiane": "11-12", "marc": "04-25",
    "marcel": "01-16", "marcelle": "01-31", "albert": "11-15", "simon": "10-28", "simone": "10-28", "gilbert": "06-07", "gilles": "09-01",
}


def norm(name):
    s = unicodedata.normalize("NFKD", (name or "").strip().lower()).encode("ascii", "ignore").decode()
    return s.replace(" ", "-")


_BY_NAME = {}
for _day, _names in FETES.items():
    for _n in _names:
        _BY_NAME.setdefault(norm(_n), _day)
for _n, _day in ALIASES.items():
    _BY_NAME[_n] = _day  # les formes courantes (Marie le 15 août, Jean le 27 décembre…) priment


def of_day(d):
    """Prénoms fêtés ce jour."""
    return FETES.get(d.strftime("%m-%d"), [])


def label(d):
    names = [n for n in of_day(d) if n not in ("Toussaint", "Défunts", "Innocents", "Croix glorieuse", "Immaculée Conception", "Présentation de Marie", "Notre-Dame de Lourdes")]
    return " et ".join(names[:2]) if names else ""


def day_of(first_name):
    """« MM-JJ » de la fête d'un prénom (prénom composé : le prénom entier, puis le premier), ou None."""
    n = norm(first_name)
    if not n:
        return None
    return _BY_NAME.get(n) or _BY_NAME.get(n.split("-")[0])


def date_in(first_name, year):
    d = day_of(first_name)
    if not d:
        return None
    try:
        return date(year, int(d[:2]), int(d[3:]))
    except ValueError:  # 29 février
        return date(year, 2, 28)
