export interface Reading {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly year: number;
  readonly authorDied: number;
  readonly source: string;
  readonly text: string;
}

// `year` is first publication, not the transcription's edition year.
// Edition details, public-domain evidence, and normalization: public/texts/CREDITS.md.
export const READINGS: readonly Reading[] = [
  {
    id: 'shakespeare-sonnet-18',
    title: 'Sonnet 18',
    author: 'William Shakespeare',
    year: 1609,
    authorDied: 1616,
    source: 'https://en.wikisource.org/wiki/Shakespeare%27s_Sonnets_(1883)/Sonnet_18',
    text: `Shall I compare thee to a summer's day?
Thou art more lovely and more temperate:
Rough winds do shake the darling buds of May,
And summer's lease hath all too short a date;
Sometime too hot the eye of heaven shines,
And often is his gold complexion dimm'd;
And every fair from fair sometime declines,
By chance or nature's changing course untrimm'd;
But thy eternal summer shall not fade
Nor lose possession of that fair thou owest;
Nor shall Death brag thou wander'st in his shade,
When in eternal lines to time thou growest:
So long as men can breathe, or eyes can see,
So long lives this and this gives life to thee.`,
  },
  {
    id: 'shakespeare-sonnet-29',
    title: 'Sonnet 29',
    author: 'William Shakespeare',
    year: 1609,
    authorDied: 1616,
    source: 'https://en.wikisource.org/wiki/Shakespeare%27s_Sonnets_(1883)/Sonnet_29',
    text: `When, in disgrace with fortune and men's eyes,
I all alone beweep my outcast state,
And trouble deaf heaven with my bootless cries,
And look upon myself and curse my fate,
Wishing me like to one more rich in hope,
Featur'd like him, like him with friends possess'd,
Desiring this man's art and that man's scope,
With what I most enjoy contented least;
Yet in these thoughts my self almost despising,
Haply I think on thee, and then my state,
Like to the lark at break of day arising
From sullen earth, sings hymns at heaven's gate:
For thy sweet love remember'd such wealth brings
That then I scorn to change my state with kings.`,
  },
  {
    id: 'shakespeare-sonnet-116',
    title: 'Sonnet 116',
    author: 'William Shakespeare',
    year: 1609,
    authorDied: 1616,
    source: 'https://en.wikisource.org/wiki/Shakespeare%27s_Sonnets_(1883)/Sonnet_116',
    text: `Let me not to the marriage of true minds
Admit impediments. Love is not love
Which alters when it alteration finds,
Or bends with the remover to remove:
O, no! it is an ever-fixed mark
That looks on tempests and is never shaken;
It is the star to every wandering bark,
Whose worth 's unknown, although his height be taken.
Love's not Time's fool, though rosy lips and cheeks
Within his bending sickle's compass come;
Love alters not with his brief hours and weeks,
But bears it out even to the edge of doom.
If this be error and upon me prov'd,
I never writ, nor no man ever lov'd.`,
  },
  {
    id: 'blake-the-lamb',
    title: 'The Lamb',
    author: 'William Blake',
    year: 1789,
    authorDied: 1827,
    source: 'https://en.wikisource.org/wiki/Page:Songs_of_Innocence_and_of_Experience,_copy_Z,_1826_(Library_of_Congress).pdf/8',
    text: `Little Lamb who made thee
Dost thou know who made thee
Gave thee life & bid thee feed,
By the stream & o'er the mead;
Gave thee clothing of delight,
Softest clothing wooly bright;
Gave thee such a tender voice,
Making all the vales rejoice:
Little Lamb who made thee
Dost thou know who made thee

Little Lamb I'll tell thee,
Little Lamb I'll tell thee:
He is called by thy name
For he calls himself a Lamb.
He is meek & he is mild,
He became a little child:
I a child & thou a lamb,
We are called by his name.
Little Lamb God bless thee
Little Lamb God bless thee.`,
  },
  {
    id: 'blake-the-tyger',
    title: 'The Tyger',
    author: 'William Blake',
    year: 1794,
    authorDied: 1827,
    source: 'https://en.wikisource.org/wiki/Page:Songs_of_Innocence_and_of_Experience,_copy_Z,_1826_(Library_of_Congress).pdf/42',
    text: `Tyger Tyger, burning bright,
In the forests of the night:
What immortal hand or eye,
Could frame thy fearful symmetry?

In what distant deeps or skies
Burnt the fire of thine eyes?
On what wings dare he aspire?
What the hand dare sieze the fire?

And what shoulder, & what art,
Could twist the sinews of thy heart?
And when thy heart began to beat,
What dread hand? & what dread feet?

What the hammer? what the chain,
In what furnace was thy brain?
What the anvil? what dread grasp,
Dare its deadly terrors clasp?

When the stars threw down their spears
And water'd heaven with their tears:
Did he smile his work to see?
Did he who made the Lamb make thee?

Tyger, Tyger burning bright,
In the forests of the night:
What immortal hand or eye,
Dare frame thy fearful symmetry?`,
  },
  {
    id: 'blake-a-poison-tree',
    title: 'A Poison Tree',
    author: 'William Blake',
    year: 1794,
    authorDied: 1827,
    source: 'https://en.wikisource.org/wiki/Page:Songs_of_Innocence_and_of_Experience,_copy_Z,_1826_(Library_of_Congress).pdf/49',
    text: `I was angry with my Friend:
I told my wrath, my wrath did end.
I was angry with my foe:
I told it not, my wrath did grow.

And I waterd it in fears,
Night & morning with my tears:
And I sunned it with smiles,
And with soft deceitful wiles.

And it grew both day and night,
Till it bore an apple bright,
And my foe beheld it shine,
And he knew that it was mine,

And into my garden stole,
When the night had veild the pole:
In the morning glad I see;
My foe outstretchd beneath the tree.`,
  },
  {
    id: 'wordsworth-i-wandered-lonely-as-a-cloud',
    title: 'I Wandered Lonely as a Cloud',
    author: 'William Wordsworth',
    year: 1807,
    authorDied: 1850,
    source: 'https://en.wikisource.org/wiki/Poems_(Wordsworth,_1815)/Volume_1/I_wandered_lonely',
    text: `I wandered lonely as a Cloud
That floats on high o'er Vales and Hills,
When all at once I saw a crowd,
A host of golden Daffodils;
Beside the Lake, beneath the trees,
Fluttering and dancing in the breeze.

Continuous as the stars that shine
And twinkle on the milky way,
They stretched in never-ending line
Along the margin of a bay:
Ten thousand saw I at a glance,
Tossing their heads in sprightly dance.

The waves beside them danced, but they
Out-did the sparkling waves in glee:--
A Poet could not but be gay
In such a jocund company:
I gazed--and gazed--but little thought
What wealth the shew to me had brought:

For oft when on my couch I lie
In vacant or in pensive mood,
They flash upon that inward eye
Which is the bliss of solitude,
And then my heart with pleasure fills,
And dances with the Daffodils.`,
  },
  {
    id: 'wordsworth-my-heart-leaps-up',
    title: 'My Heart Leaps Up',
    author: 'William Wordsworth',
    year: 1807,
    authorDied: 1850,
    source: 'https://en.wikisource.org/wiki/Poems,_in_Two_Volumes_(Wordsworth,_1807)/Volume_2/%27My_heart_leaps_up_when_I_behold%27',
    text: `My heart leaps up when I behold
A Rainbow in the sky:
So was it when my life began;
So is it now I am a Man;
So be it when I shall grow old,
Or let me die!
The Child is Father of the Man;
And I could wish my days to be
Bound each to each by natural piety.`,
  },
  {
    id: 'keats-on-first-looking-into-chapmans-homer',
    title: "On First Looking into Chapman's Homer",
    author: 'John Keats',
    year: 1816,
    authorDied: 1821,
    source: 'https://en.wikisource.org/wiki/The_Poetical_Works_of_John_Keats/On_first_Looking_into_Chapman%27s_Homer',
    text: `Much have I travell'd in the realms of gold,
And many goodly states and kingdoms seen;
Round many western islands have I been
Which bards in fealty to Apollo hold.
Oft of one wide expanse had I been told
That deep-brow'd Homer ruled as his demesne:
Yet did I never breathe its pure serene
Till I heard Chapman speak out loud and bold:
Then felt I like some watcher of the skies
When a new planet swims into his ken;
Or like stout Cortez when with eagle eyes
He stared at the Pacific--and all his men
Look'd at each other with a wild surmise--
Silent, upon a peak in Darien.`,
  },
  {
    id: 'keats-to-autumn',
    title: 'To Autumn',
    author: 'John Keats',
    year: 1820,
    authorDied: 1821,
    source: 'https://en.wikisource.org/wiki/The_Poetical_Works_of_John_Keats/To_Autumn',
    text: `Season of mists and mellow fruitfulness!
Close bosom-friend of the maturing sun;
Conspiring with him how to load and bless
With fruit the vines that round the thatch-eaves run;
To bend with apples the moss'd cottage-trees,
And fill all fruit with ripeness to the core;
To swell the gourd, and plump the hazel shells
With a sweet kernel; to set budding more,
And still more, later flowers for the bees,
Until they think warm days will never cease,
For Summer has o'er-brimm'd their clammy cells.

Who hath not seen thee oft amid thy store?
Sometimes whoever seeks abroad may find
Thee sitting careless on a granary floor,
Thy hair soft-lifted by the winnowing wind;
Or on a half-reap'd furrow sound asleep,
Drowsed with the fume of poppies, while thy hook
Spares the next swath and all its twined flowers;
And sometime like a gleaner thou dost keep
Steady thy laden head across a brook;
Or by a cider-press, with patient look,
Thou watchest the last oozings, hours by hours.

Where are the songs of Spring? Ay, where are they?
Think not of them, thou hast thy music too.
While barred clouds bloom the soft-dying day,
And touch the stubble-plains with rosy hue;
Then in a wailful choir the small gnats mourn
Among the river sallows, borne aloft
Or sinking as the light wind lives or dies;
And full-grown lambs loud bleat from hilly bourn:
Hedge-crickets sing; and now with treble soft
The redbreast whistles from a garden-croft,
And gathering swallows twitter in the skies.`,
  },
  {
    id: 'shelley-ozymandias',
    title: 'Ozymandias',
    author: 'Percy Bysshe Shelley',
    year: 1818,
    authorDied: 1822,
    source: 'https://en.wikisource.org/wiki/The_Examiner_(London)/Ozymandias',
    text: `I met a Traveller from an antique land,
Who said, "Two vast and trunkless legs of stone
Stand in the desart. Near them, on the sand,
Half sunk, a shattered visage lies, whose frown,
And wrinkled lip, and sneer of cold command,
Tell that its sculptor well those passions read,
Which yet survive, stamped on these lifeless things,
The hand that mocked them, and the heart that fed:
And on the pedestal these words appear:
"My name is Ozymandias, King of Kings."
Look on my works ye Mighty, and despair!
No thing beside remains. Round the decay
Of that Colossal Wreck, boundless and bare,
The lone and level sands stretch far away.`,
  },
  {
    id: 'shelley-music-when-soft-voices-die',
    title: 'Music, When Soft Voices Die',
    author: 'Percy Bysshe Shelley',
    year: 1824,
    authorDied: 1822,
    source: 'https://en.wikisource.org/wiki/The_Complete_Poetical_Works_of_Percy_Bysshe_Shelley_(ed._Hutchinson,_1914)/To_%E2%80%94%E2%80%94._%27Music,_when_soft_voices_die%27',
    text: `Music, when soft voices die,
Vibrates in the memory--
Odours, when sweet violets sicken,
Live within the sense they quicken.

Rose leaves, when the rose is dead,
Are heaped for the beloved's bed;
And so thy thoughts, when thou art gone,
Love itself shall slumber on.`,
  },
];
