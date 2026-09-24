# Third-party notices

## rcedit / node-rcedit

Copyright (c) 2013 GitHub, Inc. Licensed under the MIT License.

The build uses `rcedit` to generate the branded `runtime/旅策协同.exe` from the authorized runtime build input. The package source is https://github.com/electron/node-rcedit and it vendors https://github.com/electron/rcedit.

The MIT License permits use, copying, modification, distribution, sublicensing and sale, subject to inclusion of its copyright and permission notice. The software is provided “as is”, without warranty of any kind. The complete license text is retained at `node_modules/rcedit/LICENSE` in the development source and at the upstream repository above.

## resedit-js

Copyright (c) 2017-present jet2jety. Licensed under the MIT License. It is used by the development-only resource inspection utility. The complete license is retained at `node_modules/resedit/LICENSE`.

## sharp

Copyright Lovell Fuller and contributors. Licensed under Apache License 2.0. It is used at build time to rasterize the project-owned SVG brand asset. The complete license and third-party notices are retained in the installed development dependency and at https://github.com/lovell/sharp.

OpenClaw and the other bundled third-party components retain their own license files and notices. Product rebranding does not change their authorship or license terms.

## Optional Tavily search service

Users may separately configure their own Tavily API key for public web search. No Tavily SDK, code, search results, or credentials are bundled in this project. Search requests use the documented HTTPS API and are disabled by default. Tavily's service terms and API credit limits are determined by Tavily and must be reviewed by the key owner.

## Optional SearXNG search service

Users may connect a separately operated SearXNG instance through its JSON Search API. No SearXNG source code, container image, configuration, search result, or credential is bundled in this project. SearXNG is an independent project distributed under the GNU Affero General Public License version 3 or later; deployment operators remain responsible for its license, upstream search-engine terms, access control, rate limiting, and network security. See https://github.com/searxng/searxng and https://docs.searxng.org/dev/search_api.html.

## Optional AMap Web Service APIs

Users may separately configure their own AMap Web Service API key for geocoding, weather, route planning, and coordinate lookup. No AMap SDK, map tile, response data, account, or credential is bundled in this project. Calls are disabled by default and are sent only to `https://restapi.amap.com`. AMap service terms, privacy rules, attribution requirements, quotas, and pricing are determined by AMap and must be reviewed by the key owner. Official documentation: https://lbs.amap.com/api/webservice/summary .

Official references: https://docs.tavily.com/documentation/api-reference/endpoint/search ; https://docs.tavily.com/documentation/api-credits ; https://www.tavily.com/terms .

## Read-only UI design references

AdventureLog (GPLv3), TREK (AGPLv3), and TRIP (MIT) were reviewed as read-only UI references. This project does not copy, bundle, install, or execute their code, styles, text, brands, icons, screenshots, or other assets. The V5 journey interface is an independent clean-room implementation of general travel information patterns such as day cards, route sequencing, and progressive detail disclosure.
