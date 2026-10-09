window.EZ = {
 "snapshot": {
  "date": "2026-10-09",
  "count": 21,
  "forSale": 13,
  "underContract": 3,
  "forRent": 5
 },
 "cases": [
  {
   "id": "199c4a1e7f3b0a01",
   "time": "6:52 AM",
   "from": "Tanya Brooks",
   "email": "tanya.brooks@example.com",
   "subject": "8303 Bahia still available?",
   "body": "Hi! Is 8303 Bahia still available? My husband and I are pre-approved for an FHA loan and we'd love to see it this Saturday or Sunday.\n\nThank you,\nTanya Brooks",
   "attachments": [],
   "threadNote": null,
   "status": "Listing matched",
   "tone": "ok",
   "extraction": {
    "category": "buyer_inquiry",
    "language": "en",
    "sender_name": "Tanya Brooks",
    "property_mentions": [
     "8303 Bahia"
    ],
    "financing": "fha",
    "budget_max": null,
    "area": null,
    "seller_property": null,
    "details": [
     "Pre-approved for an FHA loan",
     "Wants a showing Saturday or Sunday"
    ],
    "contract_change": null,
    "summary": "Asks if 8303 Bahia is available; FHA pre-approval; wants a weekend showing.",
    "confidence": "high"
   },
   "mentions": [
    "8303 Bahia"
   ],
   "trace": [
    {
     "step": "Contact",
     "result": "New contact C-0413",
     "why": "no contact with tanya.brooks@example.com"
    },
    {
     "step": "Listing",
     "result": "8303 Bahia Ave, Tampa (for sale)",
     "why": "house number 8303 and street \"bahia\" matched 1 of 21 listings"
    },
    {
     "step": "Lead",
     "result": "New buyer lead L-0302",
     "why": "no lead yet for this contact on this listing"
    },
    {
     "step": "Interaction",
     "result": "Logged I-1180",
     "why": "message 199c4a1e7f3b0a01"
    }
   ],
   "listing": {
    "id": "EZ-5000",
    "address": "8303 Bahia Ave",
    "city": "Tampa",
    "zip": "33619",
    "status": "FOR SALE",
    "type": "SFM",
    "financing": "FHA/VA/Conv",
    "price": 327900,
    "rent": "",
    "deposit": "",
    "beds": 4,
    "baths": 2,
    "section8": false,
    "url": "https://www.ezwayhouses.com/Home/ViewDetails?PropertyID=5000",
    "captured": "2026-10-09",
    "photo": "img/5000.jpg"
   },
   "lead": {
    "id": "L-0302",
    "created": "2026-10-09"
   },
   "alternatives": [],
   "changes": [
    {
     "tab": "Contacts",
     "id": "C-0413",
     "kind": "added",
     "rows": [
      {
       "field": "name",
       "before": null,
       "after": "Tanya Brooks"
      },
      {
       "field": "role",
       "before": null,
       "after": "buyer"
      },
      {
       "field": "language",
       "before": null,
       "after": "en"
      }
     ]
    },
    {
     "tab": "Leads",
     "id": "L-0302",
     "kind": "added",
     "rows": [
      {
       "field": "kind",
       "before": null,
       "after": "buyer"
      },
      {
       "field": "property_address",
       "before": null,
       "after": "8303 Bahia Ave, Tampa"
      },
      {
       "field": "stage",
       "before": null,
       "after": "New inquiry"
      }
     ]
    },
    {
     "tab": "Interactions",
     "id": "I-1180",
     "kind": "added",
     "rows": [
      {
       "field": "lead_id",
       "before": null,
       "after": "L-0302"
      },
      {
       "field": "summary",
       "before": null,
       "after": "Asks if 8303 Bahia is available; FHA pre-approval; wants a weekend showing."
      }
     ]
    }
   ],
   "draft": {
    "to": "tanya.brooks@example.com",
    "subject": "Re: 8303 Bahia still available?",
    "text": "Hi Tanya,\n\nThanks for writing. 8303 Bahia Ave in Tampa is still listed for sale on our site at $327,900, and the listing shows FHA, VA or conventional financing, or cash. It is a 4 bed, 2 bath home.\n\nWe can look at a weekend showing. Which day and time suit you best? Someone from our team will confirm the time with you.\n\nThe EZ Way Houses team",
    "problems": [],
    "inserted": [
     "8303 Bahia Ave",
     "Tampa",
     "$327,900",
     "FHA, VA or conventional financing, or cash"
    ],
    "language": "en"
   }
  },
  {
   "id": "199c4b5d2e81c702",
   "time": "7:14 AM",
   "from": "Luis Ortega",
   "email": "l.ortega@example.com",
   "subject": "Dartmouth Ave house, FHA?",
   "body": "Good morning,\n\nI saw the house at 9513 N Dartmouth Ave. I have an FHA pre-approval for up to $330,000 and I want to stay in Tampa. Can I buy this one with my FHA loan?\n\nThanks,\nLuis Ortega",
   "attachments": [],
   "threadNote": null,
   "status": "Financing mismatch",
   "tone": "warn",
   "extraction": {
    "category": "buyer_inquiry",
    "language": "en",
    "sender_name": "Luis Ortega",
    "property_mentions": [
     "9513 N Dartmouth Ave"
    ],
    "financing": "fha",
    "budget_max": 330000,
    "area": "Tampa",
    "seller_property": null,
    "details": [
     "FHA pre-approval up to $330,000",
     "Wants to stay in Tampa"
    ],
    "contract_change": null,
    "summary": "Asks if he can buy 9513 N Dartmouth Ave with an FHA loan; budget up to $330,000 in Tampa.",
    "confidence": "high"
   },
   "mentions": [
    "9513 N Dartmouth Ave"
   ],
   "trace": [
    {
     "step": "Contact",
     "result": "New contact C-0414",
     "why": "no contact with l.ortega@example.com"
    },
    {
     "step": "Listing",
     "result": "9513 N Dartmouth Ave, Tampa (for sale)",
     "why": "house number 9513 and street \"dartmouth\" and street type \"ave\" and direction N matched 1 of 21 listings"
    },
    {
     "step": "Lead",
     "result": "New buyer lead L-0303",
     "why": "no lead yet for this contact on this listing"
    },
    {
     "step": "Interaction",
     "result": "Logged I-1181",
     "why": "message 199c4b5d2e81c702"
    },
    {
     "step": "Alternatives",
     "result": "3 listed with FHA in Tampa at or under $330,000",
     "why": "budget and area stated in the email"
    }
   ],
   "listing": {
    "id": "EZ-5009",
    "address": "9513 N Dartmouth Ave",
    "city": "Tampa",
    "zip": "33612",
    "status": "FOR SALE",
    "type": "SFM",
    "financing": "Cash/Hard.M",
    "price": 264900,
    "rent": "",
    "deposit": "",
    "beds": 3,
    "baths": 1,
    "section8": false,
    "url": "https://www.ezwayhouses.com/Home/ViewDetails?PropertyID=5009",
    "captured": "2026-10-09",
    "photo": "img/5009.jpg"
   },
   "lead": {
    "id": "L-0303",
    "created": "2026-10-09"
   },
   "alternatives": [
    {
     "listing_id": "EZ-4962",
     "address": "4922 S 82nd St",
     "city": "Tampa",
     "price": 327900,
     "beds": 4,
     "baths": 2
    },
    {
     "listing_id": "EZ-5000",
     "address": "8303 Bahia Ave",
     "city": "Tampa",
     "price": 327900,
     "beds": 4,
     "baths": 2
    },
    {
     "listing_id": "EZ-4930",
     "address": "8309 Tupelo Dr",
     "city": "Tampa",
     "price": 327900,
     "beds": 3,
     "baths": 2
    }
   ],
   "changes": [
    {
     "tab": "Contacts",
     "id": "C-0414",
     "kind": "added",
     "rows": [
      {
       "field": "name",
       "before": null,
       "after": "Luis Ortega"
      },
      {
       "field": "role",
       "before": null,
       "after": "buyer"
      },
      {
       "field": "language",
       "before": null,
       "after": "en"
      }
     ]
    },
    {
     "tab": "Leads",
     "id": "L-0303",
     "kind": "added",
     "rows": [
      {
       "field": "kind",
       "before": null,
       "after": "buyer"
      },
      {
       "field": "property_address",
       "before": null,
       "after": "9513 N Dartmouth Ave, Tampa"
      },
      {
       "field": "stage",
       "before": null,
       "after": "New inquiry"
      }
     ]
    },
    {
     "tab": "Interactions",
     "id": "I-1181",
     "kind": "added",
     "rows": [
      {
       "field": "lead_id",
       "before": null,
       "after": "L-0303"
      },
      {
       "field": "summary",
       "before": null,
       "after": "Asks if he can buy 9513 N Dartmouth Ave with an FHA loan; budget up to $330,000 in Tampa."
      }
     ]
    }
   ],
   "draft": {
    "to": "l.ortega@example.com",
    "subject": "Re: Dartmouth Ave house, FHA?",
    "text": "Hi Luis,\n\nThank you for your interest in 9513 N Dartmouth Ave. This house is listed on these terms: cash or hard money only, at $264,900. Our team can walk you through what that means for your situation.\n\nSince you mentioned an FHA pre-approval and Tampa, these homes on our site today are listed with FHA, VA or conventional financing within the budget you gave:\n- 4922 S 82nd St, Tampa: $327,900, 4 bed / 2 bath\n- 8303 Bahia Ave, Tampa: $327,900, 4 bed / 2 bath\n- 8309 Tupelo Dr, Tampa: $327,900, 3 bed / 2 bath\n\nWould you like to see one of them, or talk with us about the Dartmouth house first?\n\nThe EZ Way Houses team",
    "problems": [],
    "inserted": [
     "9513 N Dartmouth Ave",
     "Tampa",
     "$264,900",
     "4922 S 82nd St",
     "$327,900",
     "8303 Bahia Ave",
     "$327,900",
     "8309 Tupelo Dr",
     "$327,900",
     "cash or hard money only"
    ],
    "language": "en"
   }
  },
  {
   "id": "199c4cc90a4f1e03",
   "time": "7:39 AM",
   "from": "Gloria Haines",
   "email": "gloria.haines@example.com",
   "subject": "Re: Selling my house in Brandon",
   "body": "Hi again,\n\nFollowing up on my house at 2214 Windward Palms Ct. We'd still like a cash offer. The roof was replaced in 2019 and we could be out by the end of November. Let me know what you need from me.\n\nGloria",
   "attachments": [],
   "threadNote": "Second email in a thread that started on Sep 24",
   "status": "Existing lead found",
   "tone": "ok",
   "extraction": {
    "category": "seller_lead",
    "language": "en",
    "sender_name": "Gloria Haines",
    "property_mentions": [],
    "financing": "unknown",
    "budget_max": null,
    "area": "Brandon",
    "seller_property": "2214 Windward Palms Ct",
    "details": [
     "Still wants a cash offer",
     "Roof replaced in 2019",
     "Can move out by the end of November"
    ],
    "contract_change": null,
    "summary": "Follow-up: still wants a cash offer; roof replaced in 2019; can move out by end of November.",
    "confidence": "high"
   },
   "mentions": [
    "2214 Windward Palms Ct"
   ],
   "trace": [
    {
     "step": "Contact",
     "result": "Found C-0388 (Gloria Haines)",
     "why": "same sender address gloria.haines@example.com"
    },
    {
     "step": "Lead",
     "result": "Existing seller lead L-0291",
     "why": "house number 2214 and street \"windward palms\" and street type \"ct\" matched 1 of 1 seller lead of this contact"
    },
    {
     "step": "Interaction",
     "result": "Logged I-1182",
     "why": "message 199c4cc90a4f1e03"
    }
   ],
   "listing": null,
   "lead": {
    "id": "L-0291",
    "created": "2026-09-24"
   },
   "alternatives": [],
   "changes": [
    {
     "tab": "Contacts",
     "id": "C-0388",
     "kind": "updated",
     "rows": [
      {
       "field": "last_contact",
       "before": "2026-09-24",
       "after": "2026-10-09"
      }
     ]
    },
    {
     "tab": "Leads",
     "id": "L-0291",
     "kind": "updated",
     "rows": [
      {
       "field": "last_contact",
       "before": "2026-09-24",
       "after": "2026-10-09"
      }
     ]
    },
    {
     "tab": "Interactions",
     "id": "I-1182",
     "kind": "added",
     "rows": [
      {
       "field": "lead_id",
       "before": null,
       "after": "L-0291"
      },
      {
       "field": "summary",
       "before": null,
       "after": "Follow-up: still wants a cash offer; roof replaced in 2019; can move out by end of November."
      }
     ]
    }
   ],
   "draft": {
    "to": "gloria.haines@example.com",
    "subject": "Re: Selling my house in Brandon",
    "text": "Hi Gloria,\n\nThanks for following up. We added your notes to the file for 2214 Windward Palms Ct, Brandon: the roof replaced in 2019, and a move-out possible by the end of November.\n\nSomeone from our team will contact you about the next steps toward a cash offer.\n\nThe EZ Way Houses team",
    "problems": [],
    "inserted": [
     "2214 Windward Palms Ct, Brandon"
    ],
    "language": "en"
   }
  },
  {
   "id": "199c4e41b8d27a04",
   "time": "8:06 AM",
   "from": "Yamilet Rosales",
   "email": "yrosales@example.com",
   "subject": "Casa en Coral Vine, Sección 8",
   "body": "Buenos días,\n\nVi la casa de 7705 Coral Vine Ln para rentar. Tengo voucher de Sección 8 para 3 cuartos. ¿La aceptan? ¿Cuánto es el depósito y cuándo se puede ver?\n\nGracias,\nYamilet Rosales",
   "attachments": [],
   "threadNote": null,
   "status": "Rental, terms from the listing",
   "tone": "ok",
   "extraction": {
    "category": "rental_inquiry",
    "language": "es",
    "sender_name": "Yamilet Rosales",
    "property_mentions": [
     "7705 Coral Vine Ln"
    ],
    "financing": "section8_voucher",
    "budget_max": null,
    "area": null,
    "seller_property": null,
    "details": [
     "Section 8 voucher for 3 bedrooms",
     "Asks about the deposit",
     "Asks when she can see it"
    ],
    "contract_change": null,
    "summary": "Spanish. Asks if Section 8 is accepted for 7705 Coral Vine Ln, the deposit, and a viewing time. Has a 3-bedroom voucher.",
    "confidence": "high"
   },
   "mentions": [
    "7705 Coral Vine Ln"
   ],
   "trace": [
    {
     "step": "Contact",
     "result": "New contact C-0415",
     "why": "no contact with yrosales@example.com"
    },
    {
     "step": "Listing",
     "result": "7705 Coral Vine Ln, Tampa (for rent)",
     "why": "house number 7705 and street \"coral vine\" and street type \"ln\" matched 1 of 5 rental listings"
    },
    {
     "step": "Lead",
     "result": "New rental lead L-0304",
     "why": "no lead yet for this contact on this listing"
    },
    {
     "step": "Interaction",
     "result": "Logged I-1183",
     "why": "message 199c4e41b8d27a04"
    }
   ],
   "listing": {
    "id": "EZ-4828",
    "address": "7705 Coral Vine Ln",
    "city": "Tampa",
    "zip": "33619",
    "status": "FOR RENT",
    "type": "SFM",
    "financing": "",
    "price": "",
    "rent": 1695,
    "deposit": 1695,
    "beds": 3,
    "baths": 1,
    "section8": true,
    "url": "https://www.ezwayhouses.com/Home/ViewDetails?PropertyID=4828",
    "captured": "2026-10-09",
    "photo": "img/4828.jpg"
   },
   "lead": {
    "id": "L-0304",
    "created": "2026-10-09"
   },
   "alternatives": [],
   "changes": [
    {
     "tab": "Contacts",
     "id": "C-0415",
     "kind": "added",
     "rows": [
      {
       "field": "name",
       "before": null,
       "after": "Yamilet Rosales"
      },
      {
       "field": "role",
       "before": null,
       "after": "tenant"
      },
      {
       "field": "language",
       "before": null,
       "after": "es"
      }
     ]
    },
    {
     "tab": "Leads",
     "id": "L-0304",
     "kind": "added",
     "rows": [
      {
       "field": "kind",
       "before": null,
       "after": "rental"
      },
      {
       "field": "property_address",
       "before": null,
       "after": "7705 Coral Vine Ln, Tampa"
      },
      {
       "field": "stage",
       "before": null,
       "after": "New inquiry"
      }
     ]
    },
    {
     "tab": "Interactions",
     "id": "I-1183",
     "kind": "added",
     "rows": [
      {
       "field": "lead_id",
       "before": null,
       "after": "L-0304"
      },
      {
       "field": "summary",
       "before": null,
       "after": "Spanish. Asks if Section 8 is accepted for 7705 Coral Vine Ln, the deposit, and a viewing time. Has a 3-bedroom voucher."
      }
     ]
    }
   ],
   "draft": {
    "to": "yrosales@example.com",
    "subject": "Re: Casa en Coral Vine, Sección 8",
    "text": "Hola Yamilet:\n\nGracias por escribirnos. La publicación de 7705 Coral Vine Ln en Tampa indica una renta mensual de $1,695 y un depósito de $1,695, con 3 habitaciones y 1 baño. La publicación dice «Section 8 Welcome».\n\nNuestro equipo de alquileres le escribirá para revisar su voucher, la solicitud y un horario para ver la casa.\n\nEl equipo de EZ Way Houses",
    "problems": [],
    "inserted": [
     "7705 Coral Vine Ln",
     "Tampa",
     "$1,695",
     "$1,695"
    ],
    "language": "es"
   }
  },
  {
   "id": "199c4f2a6c0e9b05",
   "time": "8:21 AM",
   "from": "Brian Kessler",
   "email": "bkessler@example.com",
   "subject": "Amendment: 4415 Booker T Dr, closing date",
   "body": "Hi team,\n\nAttached is the amendment for 4415 Booker T Dr. The buyer's lender needs more time, so we're proposing to move closing from October 23 to November 6. Everything else stays the same. Please review and sign if acceptable.\n\nThanks,\nBrian Kessler",
   "attachments": [
    "Amendment_4415_Booker_T_Dr.pdf"
   ],
   "threadNote": null,
   "status": "Change needs review",
   "tone": "review",
   "extraction": {
    "category": "contract_update",
    "language": "en",
    "sender_name": "Brian Kessler",
    "property_mentions": [
     "4415 Booker T Dr"
    ],
    "financing": "unknown",
    "budget_max": null,
    "area": null,
    "seller_property": null,
    "details": [
     "Amendment attached",
     "Lender needs more time"
    ],
    "contract_change": {
     "field": "closing_date",
     "proposed": "2026-11-06",
     "quote": "we're proposing to move closing from October 23 to November 6"
    },
    "summary": "Buyer's agent sends an amendment moving closing on 4415 Booker T Dr from Oct 23 to Nov 6.",
    "confidence": "high"
   },
   "mentions": [
    "4415 Booker T Dr"
   ],
   "trace": [
    {
     "step": "Contact",
     "result": "Found C-0351 (Brian Kessler)",
     "why": "same sender address bkessler@example.com"
    },
    {
     "step": "Listing",
     "result": "4415 Booker T Dr, Tampa (under contract)",
     "why": "house number 4415 and street \"booker t\" and street type \"dr\" matched 1 of 21 listings"
    },
    {
     "step": "Transaction",
     "result": "T-0117, closing 2026-10-23",
     "why": "open transaction on EZ-4961"
    },
    {
     "step": "Change",
     "result": "closing date 2026-10-23 kept; 2026-11-06 waits for review",
     "why": "contract terms are never overwritten by the script"
    },
    {
     "step": "Interaction",
     "result": "Logged I-1184",
     "why": "message 199c4f2a6c0e9b05"
    }
   ],
   "listing": {
    "id": "EZ-4961",
    "address": "4415 Booker T Dr",
    "city": "Tampa",
    "zip": "33610",
    "status": "UNDER CONTRACT",
    "type": "SFM",
    "financing": "FHA/VA/Conv",
    "price": 339900,
    "rent": "",
    "deposit": "",
    "beds": 4,
    "baths": 2,
    "section8": false,
    "url": "https://www.ezwayhouses.com/Home/ViewDetails?PropertyID=4961",
    "captured": "2026-10-09",
    "photo": "img/4961.jpg"
   },
   "lead": null,
   "alternatives": [],
   "changes": [
    {
     "tab": "Contacts",
     "id": "C-0351",
     "kind": "updated",
     "rows": [
      {
       "field": "last_contact",
       "before": "2026-09-30",
       "after": "2026-10-09"
      }
     ]
    },
    {
     "tab": "Review",
     "id": "R-0001",
     "kind": "added",
     "rows": [
      {
       "field": "ref",
       "before": null,
       "after": "T-0117"
      },
      {
       "field": "field",
       "before": null,
       "after": "closing_date"
      },
      {
       "field": "current_value",
       "before": null,
       "after": "2026-10-23"
      },
      {
       "field": "proposed_value",
       "before": null,
       "after": "2026-11-06"
      }
     ]
    },
    {
     "tab": "Interactions",
     "id": "I-1184",
     "kind": "added",
     "rows": [
      {
       "field": "lead_id",
       "before": null,
       "after": "T-0117"
      },
      {
       "field": "summary",
       "before": null,
       "after": "Buyer's agent sends an amendment moving closing on 4415 Booker T Dr from Oct 23 to Nov 6."
      }
     ]
    }
   ],
   "draft": {
    "to": "bkessler@example.com",
    "subject": "Re: Amendment: 4415 Booker T Dr, closing date",
    "text": "Hi Brian,\n\nThanks, we received the amendment for 4415 Booker T Dr proposing to move closing from October 23 to November 6. Our team will review it and get back to you.\n\nThe EZ Way Houses team",
    "problems": [],
    "inserted": [
     "4415 Booker T Dr",
     "Tampa",
     "$339,900",
     "October 23",
     "November 6",
     "FHA, VA or conventional financing, or cash"
    ],
    "language": "en"
   }
  }
 ]
};
