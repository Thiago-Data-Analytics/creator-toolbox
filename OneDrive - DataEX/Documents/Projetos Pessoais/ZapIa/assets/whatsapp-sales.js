(function(){
  if(document.querySelector('meta[name="mbwa-disabled"]')) return;
  var ENTRY = ((window.__mbConfig||{}).API_BASE_URL||'https://api.mercabot.com.br') + '/whatsapp/abrir';
  var lang = ((document.documentElement.getAttribute('lang') || 'pt').toLowerCase().indexOf('es') === 0) ? 'es' : 'pt';
  var path = (location.pathname || '/').toLowerCase();
  function enc(text){ return encodeURIComponent(text); }
  function wa(text){ return ENTRY + '?text=' + enc(text) + '&source=' + enc(contextLabel()) + '&lang=' + enc(lang); }
  function contextLabel(){
    if(path.indexOf('/cadastro') === 0) return 'checkout';
    if(path.indexOf('/demo') === 0) return lang === 'es' ? 'demo guiada' : 'demo guiada';
    if(path.indexOf('/painel-parceiro') === 0 || path.indexOf('/guia-parceiro') === 0) return lang === 'es' ? 'área partner' : 'área parceiro';
    if(path.indexOf('/chatbot-para-whatsapp') === 0) return lang === 'es' ? 'guía de chatbot' : 'guia de chatbot';
    if(path.indexOf('/automacao-whatsapp') === 0) return lang === 'es' ? 'guía de automatización' : 'guia de automação';
    if(path.indexOf('/whatsapp-business-api') === 0) return lang === 'es' ? 'guía de API' : 'guia de API';
    if(path.indexOf('/suporte') === 0 || path.indexOf('/soporte') === 0) return lang === 'es' ? 'central digital' : 'central digital';
    return lang === 'es' ? 'sitio principal' : 'site principal';
  }
  function copy(){
    if(lang === 'es'){
      return {
        eyebrow:'WhatsApp comercial',
        title:'Habla con MercaBot por WhatsApp',
        body:'Usa este canal para resolver dudas, entender cuál plan encaja mejor con tu operación y avanzar con una recomendación más clara para tu negocio.',
        launch:'Hablar por WhatsApp',
        close:'Cerrar',
        customTitle:'Escribe tu duda',
        customBody:'Si tu caso no encaja en los atajos, escribe la duda con tus palabras y di si hablas como cliente o socio.',
        roleLabel:'Perfil',
        roleClient:'Cliente',
        rolePartner:'Socio',
        questionLabel:'Tu duda',
        questionPlaceholder:'Ej.: Tengo una clínica, quiero usar WhatsApp oficial y entender cuál plan encaja mejor.',
        customError:'Escribe tu duda antes de abrir el WhatsApp.',
        customSubmit:'Enviar duda por WhatsApp',
        options:[
          { title:'Quiero sacar dudas del producto', desc:'Precios, activación, soporte, integración y cómo funciona.', text:'Hola, MercaBot. Quiero resolver dudas sobre el producto y entender cómo funciona en mi negocio. Estoy escribiendo desde ' + contextLabel() + '.' },
          { title:'Quiero saber qué plan me conviene', desc:'Starter, Pro o Socio según etapa, volumen y operación.', text:'Hola, MercaBot. Quiero que me indiquen qué plan encaja mejor con mi operación. Explíquenme cómo decidir entre Starter, Pro y Socio. Estoy escribiendo desde ' + contextLabel() + '.' },
          { title:'Quiero recibir catálogo y precios', desc:'Recibir el catálogo comercial y entender el valor de cada plan.', text:'Hola, MercaBot. Quiero recibir el catálogo comercial con Starter, Pro y Socio y entender qué cambia entre los planes.' },
          { title:'Quiero revender o usar marca blanca', desc:'Para agencias, consultores y operación multi-cliente.', text:'Hola, MercaBot. Quiero entender el plan Socio, la reventa y el uso white-label para operar con marca propia.' }
        ]
      };
    }
    return {
      eyebrow:'WhatsApp comercial',
      title:'Tire dúvidas com a MercaBot no WhatsApp',
      body:'Use este canal para entender o produto, descobrir qual plano faz mais sentido para o seu momento e avançar com uma recomendação mais clara para a sua operação.',
      launch:'Tirar dúvidas',
      close:'Fechar',
      customTitle:'Escreva sua dúvida',
      customBody:'Se o seu caso não se encaixa nos atalhos, descreva a dúvida com suas palavras e diga se você fala como cliente ou parceiro.',
      roleLabel:'Perfil',
      roleClient:'Cliente',
      rolePartner:'Parceiro',
      questionLabel:'Sua dúvida',
      questionPlaceholder:'Ex.: Tenho uma clínica, quero usar WhatsApp oficial e entender qual plano faz mais sentido.',
      customError:'Escreva sua dúvida antes de abrir o WhatsApp.',
      customSubmit:'Enviar dúvida por WhatsApp',
      options:[
        { title:'Quero tirar dúvidas sobre o produto', desc:'Preços, ativação, suporte, integrações e como funciona na prática.', text:'Olá, MercaBot. Quero tirar dúvidas sobre o produto e entender como ele funciona no meu negócio. Estou falando a partir de ' + contextLabel() + '.' },
        { title:'Quero saber qual plano combina comigo', desc:'Starter, Pro ou Parceiro de acordo com etapa, volume e operação.', text:'Olá, MercaBot. Quero que vocês me indiquem o melhor plano para o meu momento. Me expliquem como decidir entre Starter, Pro e Parceiro. Estou falando a partir de ' + contextLabel() + '.' },
        { title:'Quero receber catálogo e preços', desc:'Catálogo comercial com os pacotes e o valor percebido de cada um.', text:'Olá, MercaBot. Quero receber o catálogo comercial com Starter, Pro e Parceiro e entender o que muda entre os planos.' },
        { title:'Quero revender ou usar marca própria', desc:'Para agências, consultores, implantadores e operação multi-cliente.', text:'Olá, MercaBot. Quero entender o plano Parceiro, revenda e uso white-label para operar com marca própria.' }
      ]
    };
  }
  function build(){
    var t = copy();
    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'mbwa-launcher';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'mbwa-drawer');
    launcher.innerHTML = '<svg class="mbwa-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.867-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.345.223-.643.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg><span class="mbwa-label">' + t.launch + '</span>';
    var drawer = document.createElement('aside');
    drawer.className = 'mbwa-drawer';
    drawer.id = 'mbwa-drawer';
    drawer.hidden = true;
    drawer.setAttribute('aria-label', t.title);
    var grid = t.options.map(function(opt){
      return '<a class="mbwa-option" href="' + wa(opt.text) + '" target="_blank" rel="noopener"><strong>' + opt.title + '</strong><span>' + opt.desc + '</span></a>';
    }).join('');
    drawer.innerHTML = '<div class="mbwa-eyebrow">WhatsApp</div><h2 class="mbwa-title">' + t.title + '</h2><p class="mbwa-copy">' + t.body + '</p><div class="mbwa-grid">' + grid + '</div><div class="mbwa-custom"><h3>' + t.customTitle + '</h3><p>' + t.customBody + '</p><div class="mbwa-field"><label for="mbwa-role">' + t.roleLabel + '</label><select id="mbwa-role" class="mbwa-select"><option value="' + t.roleClient.toLowerCase() + '">' + t.roleClient + '</option><option value="' + t.rolePartner.toLowerCase() + '">' + t.rolePartner + '</option></select></div><div class="mbwa-field"><label for="mbwa-question">' + t.questionLabel + '</label><textarea id="mbwa-question" class="mbwa-textarea" placeholder="' + t.questionPlaceholder + '"></textarea><div class="mbwa-error" id="mbwa-question-error" aria-live="polite"></div></div><button type="button" class="mbwa-submit">' + t.customSubmit + '</button></div><div class="mbwa-meta"><button type="button" class="mbwa-close">' + t.close + '</button></div>';
    function setCustomError(message){
      var error = drawer.querySelector('#mbwa-question-error');
      var question = drawer.querySelector('#mbwa-question');
      var field = question ? question.closest('.mbwa-field') : null;
      if(error) error.textContent = message || '';
      if(field) field.classList.toggle('has-error', !!message);
    }
    function sendCustomQuestion(){
      var role = drawer.querySelector('#mbwa-role');
      var question = drawer.querySelector('#mbwa-question');
      var roleValue = role ? String(role.value || '').trim() : '';
      var questionValue = question ? String(question.value || '').trim() : '';
      if(!questionValue){
        setCustomError(t.customError);
        if(question) question.focus();
        return;
      }
      setCustomError('');
      var intro = lang === 'es'
        ? 'Hola, MercaBot. Tengo una duda y hablo como ' + roleValue + '.'
        : 'Olá, MercaBot. Tenho uma dúvida e falo como ' + roleValue + '.';
      var place = lang === 'es'
        ? 'Estoy escribiendo desde ' + contextLabel() + '.'
        : 'Estou falando a partir de ' + contextLabel() + '.';
      window.open(wa(intro + ' ' + questionValue + ' ' + place), '_blank', 'noopener');
    }
    function closeDrawer(){ drawer.hidden = true; launcher.setAttribute('aria-expanded', 'false'); }
    function openDrawer(){ drawer.hidden = false; launcher.setAttribute('aria-expanded', 'true'); }
    launcher.addEventListener('click', function(){ drawer.hidden ? openDrawer() : closeDrawer(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeDrawer(); });
    document.addEventListener('click', function(e){ if(drawer.hidden) return; if(drawer.contains(e.target) || launcher.contains(e.target)) return; closeDrawer(); });
    drawer.querySelector('.mbwa-close').addEventListener('click', closeDrawer);
    drawer.querySelector('.mbwa-submit').addEventListener('click', sendCustomQuestion);
    drawer.querySelector('#mbwa-question').addEventListener('input', function(){
      if(String(this.value || '').trim()) setCustomError('');
    });
    document.body.appendChild(drawer);
    document.body.appendChild(launcher);
  }
  if(document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
