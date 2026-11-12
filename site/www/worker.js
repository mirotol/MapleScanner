// www.maplescanner.app only sends the visitor on to maplescanner.app, the one address the site
// is known by, keeping the page and anything after it. A Worker of its own, so the site's plain
// files are still served without running any code.
export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(`https://maplescanner.app${url.pathname}${url.search}`, 301);
  },
};
