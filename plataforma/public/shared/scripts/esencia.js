// CRUD wrapper para cliente_esencia
(function () {
  window.esenciaApi = {
    async obtener(leadId) {
      const { data, error } = await window.db
        .from('cliente_esencia')
        .select('*')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },

    // Valores permitidos por cliente_esencia_tono_estilo_check.
    TONO_ESTILO_VALIDOS: ['profesional','cercano','irreverente','didactico','inspiracional','directo','tecnico','reflexivo'],

    async upsert(leadId, datos) {
      // Validar tono_estilo contra CHECK constraint para no romper con error
      // críptico de 23514. Si el valor no está en la lista, descartar a null.
      const tonoValidos = this.TONO_ESTILO_VALIDOS;
      const tonoEstilo = datos.tono_estilo && tonoValidos.includes(datos.tono_estilo)
        ? datos.tono_estilo
        : null;
      if (datos.tono_estilo && !tonoValidos.includes(datos.tono_estilo)) {
        console.warn(`[esencia] tono_estilo "${datos.tono_estilo}" no es válido, valores permitidos:`, tonoValidos);
      }

      const payload = {
        lead_id: leadId,
        proposito: datos.proposito || null,
        mision_promesa: datos.mision_promesa || null,
        historia_personal: datos.historia_personal || null,
        diferenciador: datos.diferenciador || null,
        valores: datos.valores && datos.valores.length ? datos.valores : null,
        icp_marca: datos.icp_marca || null,
        problema_principal: datos.problema_principal || null,
        tono_voz: datos.tono_voz || null,
        tono_estilo: tonoEstilo,
        palabras_si: datos.palabras_si && datos.palabras_si.length ? datos.palabras_si : null,
        palabras_no: datos.palabras_no && datos.palabras_no.length ? datos.palabras_no : null,
        referencias: datos.referencias || null,
        canales_principales: datos.canales_principales && datos.canales_principales.length ? datos.canales_principales : null,
        ultima_actualizacion_at: new Date().toISOString(),
      };
      // Completitud: 14 campos, contar cuántos están llenos
      const fields = ['proposito','mision_promesa','historia_personal','diferenciador','valores','icp_marca','problema_principal','tono_voz','tono_estilo','palabras_si','palabras_no','referencias','canales_principales'];
      const llenos = fields.filter(f => {
        const v = payload[f];
        if (Array.isArray(v)) return v.length > 0;
        return v !== null && v !== '';
      }).length;
      payload.completitud_score = Math.round((llenos / fields.length) * 100);

      const { data, error } = await window.db
        .from('cliente_esencia')
        .upsert(payload, { onConflict: 'lead_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
})();
